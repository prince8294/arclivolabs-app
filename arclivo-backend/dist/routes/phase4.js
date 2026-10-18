"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const security_1 = require("../middleware/security");
const store_1 = require("../models/store");
const aiCeoService_1 = require("../services/aiCeoService");
const logger_1 = require("../utils/logger");
const router = (0, express_1.Router)();
router.use(security_1.requireOwner);
const safeError = (res, error, status = 500) => {
    if (status >= 500)
        res.status(status).json({ error: 'Internal server error.' });
    else
        res.status(status).json({ error: error instanceof Error ? error.message : String(error) });
};
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max
    ? value.trim()
    : null;
// ─── 1. AI CEO Assistant ─────────────────────────────────────────────────────
router.post('/ai/ceo/chat', async (req, res) => {
    try {
        const rawMessage = text(req.body?.message, 2000);
        if (!rawMessage) {
            res.status(400).json({ error: 'Message is required and must be under 2000 characters.' });
            return;
        }
        // Save user message to chat history
        await store_1.store.addCeoChatMessage({
            role: 'user',
            content: rawMessage,
        });
        const history = await store_1.store.getCeoChatHistory();
        const chatResponse = await aiCeoService_1.AiCeoService.chat(rawMessage, history);
        // Save assistant response to chat history
        await store_1.store.addCeoChatMessage({
            role: 'assistant',
            content: chatResponse.reply,
            isDeterministic: chatResponse.isDeterministic,
            sources: chatResponse.sources,
            suggestedActions: chatResponse.suggestedActions,
        });
        res.json(chatResponse);
    }
    catch (err) {
        logger_1.logger.error('ai_ceo_chat_error', { message: err instanceof Error ? err.message : String(err) });
        safeError(res, err);
    }
});
router.get('/ai/ceo/quick-questions', async (_req, res) => {
    try {
        const questions = await aiCeoService_1.AiCeoService.getQuickQuestions();
        res.json({ questions });
    }
    catch (err) {
        safeError(res, err);
    }
});
router.get('/ai/ceo/history', async (_req, res) => {
    try {
        const history = await store_1.store.getCeoChatHistory();
        res.json({ history });
    }
    catch (err) {
        safeError(res, err);
    }
});
router.delete('/ai/ceo/history', async (_req, res) => {
    try {
        await store_1.store.clearCeoChatHistory();
        res.json({ success: true });
    }
    catch (err) {
        safeError(res, err);
    }
});
// ─── 2. AI Smart Daily Planner ───────────────────────────────────────────────
router.get('/planner/today', async (req, res) => {
    try {
        const date = text(req.query.date, 10);
        const plan = await store_1.store.generateDailyWorkPlan(date || undefined);
        res.json(plan);
    }
    catch (err) {
        safeError(res, err);
    }
});
router.post('/planner/reschedule-task', async (req, res) => {
    try {
        const taskId = text(req.body?.taskId, 100);
        const newDueDate = text(req.body?.newDueDate, 50);
        if (!taskId || !newDueDate) {
            res.status(400).json({ error: 'taskId and newDueDate are required.' });
            return;
        }
        const task = await store_1.store.getTaskById(taskId);
        if (!task) {
            res.status(404).json({ error: 'Task not found.' });
            return;
        }
        const updated = await store_1.store.updateTask(taskId, { dueDate: newDueDate });
        res.json(updated);
    }
    catch (err) {
        safeError(res, err);
    }
});
router.post('/planner/complete-task', async (req, res) => {
    try {
        const taskId = text(req.body?.taskId, 100);
        if (!taskId) {
            res.status(400).json({ error: 'taskId is required.' });
            return;
        }
        const task = await store_1.store.getTaskById(taskId);
        if (!task) {
            res.status(404).json({ error: 'Task not found.' });
            return;
        }
        const updated = await store_1.store.updateTask(taskId, { status: 'completed' });
        res.json(updated);
    }
    catch (err) {
        safeError(res, err);
    }
});
// ─── 3. Smart Business Reminders ─────────────────────────────────────────────
router.get('/reminders', async (_req, res) => {
    try {
        const reminders = await store_1.store.getReminders();
        res.json({ reminders, total: reminders.length });
    }
    catch (err) {
        safeError(res, err);
    }
});
router.post('/reminders/:id/dismiss', async (req, res) => {
    try {
        const { id } = req.params;
        if (!id) {
            res.status(400).json({ error: 'Reminder ID is required.' });
            return;
        }
        const success = await store_1.store.dismissReminder(id);
        res.json({ success });
    }
    catch (err) {
        safeError(res, err);
    }
});
router.post('/reminders/:id/snooze', async (req, res) => {
    try {
        const { id } = req.params;
        const snoozeUntil = text(req.body?.snoozeUntil, 50);
        if (!id || !snoozeUntil) {
            res.status(400).json({ error: 'Reminder ID and snoozeUntil timestamp are required.' });
            return;
        }
        const success = await store_1.store.snoozeReminder(id, snoozeUntil);
        res.json({ success });
    }
    catch (err) {
        safeError(res, err);
    }
});
// ─── 4. Smart Business Insights ──────────────────────────────────────────────
router.get('/insights', async (req, res) => {
    try {
        const fromDate = text(req.query.fromDate, 10) || undefined;
        const toDate = text(req.query.toDate, 10) || undefined;
        const insights = await store_1.store.getBusinessInsights(fromDate, toDate);
        res.json(insights);
    }
    catch (err) {
        safeError(res, err);
    }
});
// ─── 5. AI Business Recommendations ─────────────────────────────────────────
router.get('/recommendations', async (_req, res) => {
    try {
        const recommendations = await store_1.store.getBusinessRecommendations();
        res.json({ recommendations, total: recommendations.length });
    }
    catch (err) {
        safeError(res, err);
    }
});
// ─── 6. Global Business Search ───────────────────────────────────────────────
router.get('/search', async (req, res) => {
    try {
        const q = text(req.query.q, 100);
        const category = text(req.query.category, 50) || undefined;
        if (!q) {
            res.json({ results: [] });
            return;
        }
        const results = await store_1.store.globalSearch(q, category);
        res.json({ results, total: results.length });
    }
    catch (err) {
        safeError(res, err);
    }
});
// ─── 7. Backup & Data Safety ─────────────────────────────────────────────────
router.get('/backup/export', async (_req, res) => {
    try {
        const backup = await store_1.store.exportDataBackup();
        res.json(backup);
    }
    catch (err) {
        safeError(res, err);
    }
});
// ─── 8. Recent Activity Logs ─────────────────────────────────────────────────
router.get('/activity-logs', async (req, res) => {
    try {
        const limit = Math.min(Number(req.query.limit) || 20, 100);
        const logs = await store_1.store.getActivityLogs(undefined, undefined, limit);
        res.json({ logs });
    }
    catch (err) {
        safeError(res, err);
    }
});
exports.default = router;
