import { ILead, IEmailDraft } from '../models/types';
import { store } from '../models/store';
import { logger } from '../utils/logger';

export class AiService {
  /**
   * Deterministic, high-quality personalized email generator
   * Used when offline or as template fallback. Never invents facts.
   */
  static generateDeterministicEmail(lead: ILead): IEmailDraft {
    const { businessName, category, city, website } = lead;
    const cleanCategory = category && category.toLowerCase() !== 'general' ? category : 'business';
    const cityText = city && city.toLowerCase() !== 'various' ? ` in ${city}` : '';
    const websiteMention = website ? ` (reviewed at ${website})` : '';

    const subjectOptions = [
      `Website modernization & AI workflows for ${businessName}`,
      `Quick question regarding ${businessName}'s digital presence`,
      `Streamlining operations & lead capture for ${businessName}${cityText}`,
    ];
    const subject = subjectOptions[Math.floor(Math.random() * subjectOptions.length)];

    const body = `Hi ${businessName} Team,

I hope this email finds you well${cityText}.

I am reaching out from Arclivo Labs. We specialize in building modern, high-speed websites and custom AI automation systems tailored for teams in the ${cleanCategory} space${websiteMention}.

Many businesses spend valuable hours every week manually sorting inquiries, fielding common questions, and updating records. At Arclivo Labs, we help eliminate that friction by implementing:

• High-converting, mobile-first web experiences designed to engage your visitors
• Automated 24/7 lead capture and inquiry routing bots
• Intelligent follow-up workflows so potential clients never slip through the cracks

We do not believe in cookie-cutter software—everything we develop is built to fit your exact workflow and save your team real hours.

Would you be open to a brief 10-minute conversation this week to explore whether our web and AI automation solutions could support ${businessName}'s goals?

Best regards,

Arclivo Labs Team
Website Development & AI Automation
hello@arclivo.com | https://arclivo.com

---
Opt-out: We respect your inbox. If you do not wish to receive further messages, simply reply with "Unsubscribe" and you will be immediately removed.`;

    return {
      subject,
      body,
      generatedAt: new Date().toISOString(),
      approved: false,
      customized: false,
    };
  }

  /**
   * Calls AI provider API if configured, otherwise falls back gracefully
   */
  static async generateEmail(lead: ILead): Promise<IEmailDraft> {
    const settings = await store.getAiConfig();

    if (!settings.apiKey) {
      return this.generateDeterministicEmail(lead);
    }

    try {
      if (settings.provider === 'gemini') {
        return await this.callGeminiApi(lead, settings.apiKey);
      } else if (settings.provider === 'openai') {
        return await this.callOpenAiApi(lead, settings.apiKey);
      } else {
        return this.generateDeterministicEmail(lead);
      }
    } catch (err) {
      logger.warn('ai_generation_fallback', { message: err instanceof Error ? err.message : 'unknown' });
      return this.generateDeterministicEmail(lead);
    }
  }

  /**
   * Google Gemini API implementation
   */
  private static async callGeminiApi(lead: ILead, apiKey: string): Promise<IEmailDraft> {
    const prompt = `You are an email copywriter for Arclivo Labs, a premier agency offering website development and AI automation services.
Write a personalized, professional B2B outreach email for this specific business:
- Business Name: ${lead.businessName}
- Industry/Category: ${lead.category}
- City: ${lead.city}
- Website: ${lead.website || 'Not provided'}

STRICT RULES:
1. DO NOT invent or fabricate any details about their past work, client names, awards, or fake data.
2. Clearly offer Arclivo Labs' custom website development and AI automation workflows (lead capture, automatic inquiry handling, process automation).
3. Keep the tone warm, concise, professional, and low-pressure.
4. Output in valid JSON with exactly two keys: "subject" and "body".
5. The email body must end with a standard polite opt-out notice: "Reply 'Unsubscribe' to be removed from future emails."`;

    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
    });

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
    }

    const data: any = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('No text returned from Gemini API');

    const parsed = JSON.parse(text);
    if (typeof parsed.subject !== 'string' || typeof parsed.body !== 'string') {
      throw new Error('Gemini returned an invalid draft.');
    }
    if (!/unsubscribe/i.test(parsed.body)) {
      parsed.body += `\n\nReply 'Unsubscribe' to be removed from future emails.`;
    }
    return {
      subject: parsed.subject || `Arclivo Labs Web & AI Solutions for ${lead.businessName}`,
      body: parsed.body || '',
      generatedAt: new Date().toISOString(),
      approved: false,
      customized: false,
    };
  }

  /**
   * OpenAI API implementation
   */
  private static async callOpenAiApi(lead: ILead, apiKey: string): Promise<IEmailDraft> {
    const prompt = `You are an email copywriter for Arclivo Labs (web development & AI automation).
Write a personalized B2B outreach email for:
Business Name: ${lead.businessName}
Category: ${lead.category}
City: ${lead.city}
Website: ${lead.website || 'None'}

Rules: Do not invent facts. Return JSON with "subject" and "body". Include an opt-out line at bottom.`;

    const url = 'https://api.openai.com/v1/chat/completions';
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data: any = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    const parsed = JSON.parse(content);
    if (typeof parsed.subject !== 'string' || typeof parsed.body !== 'string') {
      throw new Error('OpenAI returned an invalid draft.');
    }
    if (!/unsubscribe/i.test(parsed.body)) {
      parsed.body += `\n\nReply 'Unsubscribe' to be removed from future emails.`;
    }

    return {
      subject: parsed.subject,
      body: parsed.body,
      generatedAt: new Date().toISOString(),
      approved: false,
      customized: false,
    };
  }

  /**
   * Generate drafts for all pending eligible leads that don't have one yet
   */
  static async generateDraftsForAllPending(): Promise<{ generatedCount: number; skippedCount: number }> {
    const leads = await store.getLeads();
    let generatedCount = 0;
    let skippedCount = 0;

    for (const lead of leads) {
      if (lead.status === 'ineligible' || lead.status === 'sent') {
        skippedCount++;
        continue;
      }
      if (!lead.emailDraft || !lead.emailDraft.body) {
        const draft = await this.generateEmail(lead);
        await store.updateLead(lead.id, { emailDraft: draft, emailState: 'draft' });
        generatedCount++;
      } else {
        skippedCount++;
      }
    }

    return { generatedCount, skippedCount };
  }
}
