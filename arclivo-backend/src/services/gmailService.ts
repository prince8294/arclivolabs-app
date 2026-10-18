import crypto from 'crypto';
import { config } from '../config';
import { ErrorCategory } from '../models/types';
import { store } from '../models/store';
import { logger } from '../utils/logger';

export interface SendEmailResult {
  success: boolean;
  messageId?: string;
  threadId?: string;
  error?: string;
  errorCategory?: ErrorCategory;
  retryable?: boolean;
  uncertain?: boolean;
}

type TestTransport = (
  to: string,
  subject: string,
  body: string,
  internalMessageId: string
) => Promise<SendEmailResult>;

interface OAuthFlow {
  verifier: string;
  expiresAt: number;
}

export class GmailService {
  private static oauthFlows = new Map<string, OAuthFlow>();
  private static testTransport?: TestTransport;

  static setTestTransport(transport?: TestTransport): void {
    if (config.nodeEnv !== 'test') throw new Error('Test transport is only available in NODE_ENV=test.');
    this.testTransport = transport;
  }

  static createAuthUrl(): string {
    if (!config.googleClientId || !config.googleClientSecret) {
      throw new Error('Google OAuth is not configured.');
    }
    const state = crypto.randomBytes(32).toString('base64url');
    const verifier = crypto.randomBytes(48).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    this.oauthFlows.set(state, { verifier, expiresAt: Date.now() + 10 * 60_000 });
    for (const [key, flow] of this.oauthFlows) {
      if (flow.expiresAt <= Date.now()) this.oauthFlows.delete(key);
    }

    const scopes = [
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
    ].join(' ');
    const params = new URLSearchParams({
      client_id: config.googleClientId,
      redirect_uri: config.googleRedirectUri,
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

  static async handleAuthCallback(
    code: string,
    state: string
  ): Promise<{ success: boolean; userEmail?: string; error?: string }> {
    const flow = this.oauthFlows.get(state);
    this.oauthFlows.delete(state);
    if (!flow || flow.expiresAt <= Date.now()) return { success: false, error: 'Invalid or expired OAuth state.' };

    try {
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: config.googleClientId,
          client_secret: config.googleClientSecret,
          redirect_uri: config.googleRedirectUri,
          grant_type: 'authorization_code',
          code_verifier: flow.verifier,
        }),
        signal: AbortSignal.timeout(config.gmailTimeoutMs),
      });
      if (!response.ok) throw new Error(`Google token exchange failed with status ${response.status}.`);
      const tokenData: any = await response.json();
      if (!tokenData.access_token) throw new Error('Google did not return an access token.');

      const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
        signal: AbortSignal.timeout(config.gmailTimeoutMs),
      });
      if (!userInfoRes.ok) throw new Error(`Google user lookup failed with status ${userInfoRes.status}.`);
      const userInfo: any = await userInfoRes.json();
      if (!userInfo.email) throw new Error('Google account email was not returned.');

      await store.saveOAuthTokens({
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiryDate: Date.now() + Number(tokenData.expires_in || 3600) * 1000,
        userEmail: userInfo.email,
      });
      await store.addAuditLog({ action: 'gmail_connected', actor: 'owner', targetType: 'gmail_account' });
      return { success: true, userEmail: userInfo.email };
    } catch (error) {
      logger.warn('gmail_oauth_failed', { message: error instanceof Error ? error.message : 'unknown' });
      return { success: false, error: 'Gmail authorization failed. Please try connecting again.' };
    }
  }

  static async disconnect(): Promise<void> {
    const tokens = await store.getOAuthTokens();
    const token = tokens.refreshToken || tokens.accessToken;
    if (token) {
      try {
        await fetch('https://oauth2.googleapis.com/revoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token }),
          signal: AbortSignal.timeout(config.gmailTimeoutMs),
        });
      } catch {
        logger.warn('gmail_revoke_unconfirmed');
      }
    }
    await store.clearOAuthTokens();
    await store.addAuditLog({ action: 'gmail_disconnected', actor: 'owner', targetType: 'gmail_account' });
  }

  private static async refreshAccessToken(refreshToken: string): Promise<string | null> {
    try {
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: config.googleClientId,
          client_secret: config.googleClientSecret,
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        }),
        signal: AbortSignal.timeout(config.gmailTimeoutMs),
      });
      if (!response.ok) {
        if ([400, 401].includes(response.status)) await store.clearOAuthTokens();
        return null;
      }
      const data: any = await response.json();
      if (!data.access_token) return null;
      await store.saveOAuthTokens({
        accessToken: data.access_token,
        expiryDate: Date.now() + Number(data.expires_in || 3600) * 1000,
      });
      return data.access_token;
    } catch {
      return null;
    }
  }

  private static async accessToken(): Promise<string | null> {
    const tokens = await store.getOAuthTokens();
    if (!tokens.accessToken) return null;
    if (!tokens.expiryDate || Date.now() < tokens.expiryDate - 60_000) return tokens.accessToken;
    return tokens.refreshToken ? this.refreshAccessToken(tokens.refreshToken) : null;
  }

  static async testConnection(): Promise<{ connected: boolean; userEmail?: string; error?: string }> {
    const token = await this.accessToken();
    if (!token) return { connected: false, error: 'Gmail is not connected or authorization was revoked.' };
    try {
      const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(config.gmailTimeoutMs),
      });
      if (!response.ok) {
        if (response.status === 401) await store.clearOAuthTokens();
        return { connected: false, error: 'Gmail authorization is no longer valid.' };
      }
      const data: any = await response.json();
      return { connected: true, userEmail: data.email };
    } catch {
      return { connected: false, error: 'Unable to verify Gmail right now.' };
    }
  }

  private static createMimeMessage(
    from: string,
    to: string,
    subject: string,
    bodyText: string,
    internalMessageId: string
  ): string {
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

  static async sendEmail(
    to: string,
    subject: string,
    body: string,
    internalMessageId: string
  ): Promise<SendEmailResult> {
    if (this.testTransport) return this.testTransport(to, subject, body, internalMessageId);
    const settings = await store.getSettings();
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
        signal: AbortSignal.timeout(config.gmailTimeoutMs),
      });
      if (response.ok) {
        const data: any = await response.json();
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
        await store.clearOAuthTokens();
        return { success: false, error: 'Gmail authorization was rejected.', errorCategory: 'authentication' };
      }
      if (response.status === 429) {
        return { success: false, error: 'Gmail rate limit reached.', errorCategory: 'rate_limit', retryable: true };
      }
      if (response.status >= 500) {
        return { success: false, error: `Gmail temporary error (${response.status}).`, errorCategory: 'temporary', retryable: true };
      }
      return { success: false, error: `Gmail rejected the message (${response.status}).`, errorCategory: 'permanent' };
    } catch (error) {
      logger.warn('gmail_send_confirmation_lost', { message: error instanceof Error ? error.message : 'network error' });
      return {
        success: false,
        error: 'Delivery confirmation was lost. The message will not be retried automatically.',
        errorCategory: 'delivery_unconfirmed',
        uncertain: true,
      };
    }
  }
}
