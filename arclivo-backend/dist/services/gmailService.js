"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GmailService = void 0;
const crypto_1 = __importDefault(require("crypto"));
const config_1 = require("../config");
const store_1 = require("../models/store");
const logger_1 = require("../utils/logger");
class GmailService {
    static testTransport;
    static setTestTransport(transport) {
        if (config_1.config.nodeEnv !== 'test')
            throw new Error('Test transport is only available in NODE_ENV=test.');
        this.testTransport = transport;
    }
    static async createAuthUrl() {
        if (!config_1.config.googleClientId || !config_1.config.googleClientSecret) {
            throw new Error('Google OAuth is not configured.');
        }
        const state = crypto_1.default.randomBytes(32).toString('base64url');
        const verifier = crypto_1.default.randomBytes(48).toString('base64url');
        const challenge = crypto_1.default.createHash('sha256').update(verifier).digest('base64url');
        await store_1.store.saveOAuthFlow(state, verifier, Date.now() + 10 * 60_000);
        const scopes = [
            'https://www.googleapis.com/auth/gmail.send',
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/userinfo.profile',
        ].join(' ');
        const params = new URLSearchParams({
            client_id: config_1.config.googleClientId,
            redirect_uri: config_1.config.googleRedirectUri,
            response_type: 'code',
            scope: scopes,
            access_type: 'offline',
            prompt: 'consent',
            state,
            code_challenge: challenge,
            code_challenge_method: 'S256',
        });
        return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    }
    static async handleAuthCallback(code, state) {
        const flow = await store_1.store.consumeOAuthFlow(state);
        if (!flow || flow.expiresAt <= Date.now())
            return { success: false, error: 'Invalid or expired OAuth state.' };
        try {
            const response = await fetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    code,
                    client_id: config_1.config.googleClientId,
                    client_secret: config_1.config.googleClientSecret,
                    redirect_uri: config_1.config.googleRedirectUri,
                    grant_type: 'authorization_code',
                    code_verifier: flow.verifier,
                }),
                signal: AbortSignal.timeout(config_1.config.gmailTimeoutMs),
            });
            if (!response.ok)
                throw new Error(`Google token exchange failed with status ${response.status}.`);
            const tokenData = await response.json();
            if (!tokenData.access_token)
                throw new Error('Google did not return an access token.');
            const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                headers: { Authorization: `Bearer ${tokenData.access_token}` },
                signal: AbortSignal.timeout(config_1.config.gmailTimeoutMs),
            });
            if (!userInfoRes.ok)
                throw new Error(`Google user lookup failed with status ${userInfoRes.status}.`);
            const userInfo = await userInfoRes.json();
            if (!userInfo.email)
                throw new Error('Google account email was not returned.');
            await store_1.store.saveOAuthTokens({
                accessToken: tokenData.access_token,
                refreshToken: tokenData.refresh_token,
                expiryDate: Date.now() + Number(tokenData.expires_in || 3600) * 1000,
                userEmail: userInfo.email,
            });
            await store_1.store.addAuditLog({ action: 'gmail_connected', actor: 'owner', targetType: 'gmail_account' });
            return { success: true, userEmail: userInfo.email };
        }
        catch (error) {
            logger_1.logger.warn('gmail_oauth_failed', { message: error instanceof Error ? error.message : 'unknown' });
            return { success: false, error: 'Gmail authorization failed. Please try connecting again.' };
        }
    }
    static async disconnect() {
        const tokens = await store_1.store.getOAuthTokens();
        const token = tokens.refreshToken || tokens.accessToken;
        if (token) {
            try {
                await fetch('https://oauth2.googleapis.com/revoke', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({ token }),
                    signal: AbortSignal.timeout(config_1.config.gmailTimeoutMs),
                });
            }
            catch {
                logger_1.logger.warn('gmail_revoke_unconfirmed');
            }
        }
        await store_1.store.clearOAuthTokens();
        await store_1.store.addAuditLog({ action: 'gmail_disconnected', actor: 'owner', targetType: 'gmail_account' });
    }
    static async refreshAccessToken(refreshToken) {
        try {
            const response = await fetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    client_id: config_1.config.googleClientId,
                    client_secret: config_1.config.googleClientSecret,
                    refresh_token: refreshToken,
                    grant_type: 'refresh_token',
                }),
                signal: AbortSignal.timeout(config_1.config.gmailTimeoutMs),
            });
            if (!response.ok) {
                if ([400, 401].includes(response.status))
                    await store_1.store.clearOAuthTokens();
                return null;
            }
            const data = await response.json();
            if (!data.access_token)
                return null;
            await store_1.store.saveOAuthTokens({
                accessToken: data.access_token,
                expiryDate: Date.now() + Number(data.expires_in || 3600) * 1000,
            });
            return data.access_token;
        }
        catch {
            return null;
        }
    }
    static async accessToken() {
        const tokens = await store_1.store.getOAuthTokens();
        if (!tokens.accessToken)
            return null;
        if (!tokens.expiryDate || Date.now() < tokens.expiryDate - 60_000)
            return tokens.accessToken;
        return tokens.refreshToken ? this.refreshAccessToken(tokens.refreshToken) : null;
    }
    static async testConnection() {
        const token = await this.accessToken();
        if (!token)
            return { connected: false, error: 'Gmail is not connected or authorization was revoked.' };
        try {
            const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                headers: { Authorization: `Bearer ${token}` },
                signal: AbortSignal.timeout(config_1.config.gmailTimeoutMs),
            });
            if (!response.ok) {
                if (response.status === 401)
                    await store_1.store.clearOAuthTokens();
                return { connected: false, error: 'Gmail authorization is no longer valid.' };
            }
            const data = await response.json();
            return { connected: true, userEmail: data.email };
        }
        catch {
            return { connected: false, error: 'Unable to verify Gmail right now.' };
        }
    }
    static createMimeMessage(from, to, subject, bodyText, internalMessageId) {
        const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
        const message = [
            `From: Arclivo Labs <${from}>`,
            `To: ${to}`,
            `Subject: ${utf8Subject}`,
            `Message-ID: <${internalMessageId}@arclivo.local>`,
            'MIME-Version: 1.0',
            'Content-Type: text/plain; charset=UTF-8',
            'Content-Transfer-Encoding: 8bit',
            '',
            bodyText,
        ].join('\r\n');
        return Buffer.from(message).toString('base64url');
    }
    static async sendEmail(to, subject, body, internalMessageId) {
        if (this.testTransport)
            return this.testTransport(to, subject, body, internalMessageId);
        const settings = await store_1.store.getSettings();
        const token = await this.accessToken();
        if (!settings.gmailConnected || !token) {
            return { success: false, error: 'Gmail account is not connected.', errorCategory: 'authentication' };
        }
        const raw = this.createMimeMessage(settings.gmailUserEmail || 'me', to, subject, body, internalMessageId);
        try {
            const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ raw }),
                signal: AbortSignal.timeout(config_1.config.gmailTimeoutMs),
            });
            if (response.ok) {
                const data = await response.json();
                if (!data.id) {
                    return {
                        success: false,
                        error: 'Gmail accepted the request without a delivery identifier.',
                        errorCategory: 'delivery_unconfirmed',
                        uncertain: true,
                    };
                }
                return { success: true, messageId: data.id, threadId: data.threadId };
            }
            if (response.status === 401) {
                await store_1.store.clearOAuthTokens();
                return { success: false, error: 'Gmail authorization was rejected.', errorCategory: 'authentication' };
            }
            if (response.status === 429) {
                return { success: false, error: 'Gmail rate limit reached.', errorCategory: 'rate_limit', retryable: true };
            }
            if (response.status >= 500) {
                return { success: false, error: `Gmail temporary error (${response.status}).`, errorCategory: 'temporary', retryable: true };
            }
            return { success: false, error: `Gmail rejected the message (${response.status}).`, errorCategory: 'permanent' };
        }
        catch (error) {
            logger_1.logger.warn('gmail_send_confirmation_lost', { message: error instanceof Error ? error.message : 'network error' });
            return {
                success: false,
                error: 'Delivery confirmation was lost. The message will not be retried automatically.',
                errorCategory: 'delivery_unconfirmed',
                uncertain: true,
            };
        }
    }
}
exports.GmailService = GmailService;
