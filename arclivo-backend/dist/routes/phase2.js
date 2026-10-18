"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const security_1 = require("../middleware/security");
const store_1 = require("../models/store");
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
const optionalText = (value, max) => typeof value === 'string' && value.trim().length <= max ? value.trim() : '';
const CLIENT_STATUSES = ['new', 'active', 'project_ongoing', 'completed', 'inactive'];
const PROJECT_STATUSES = ['planning', 'in_progress', 'on_hold', 'testing', 'completed', 'cancelled'];
const PROJECT_PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const PROJECT_TYPES = [
    'business_website', 'ecommerce_website', 'web_application', 'mobile_application',
    'ai_automation', 'crm_development', 'seo_digital_marketing', 'website_maintenance', 'other',
];
const TASK_STATUSES = ['todo', 'in_progress', 'completed', 'on_hold'];
const TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent'];
// ─── Clients ─────────────────────────────────────────────────────────────────
router.get('/clients', async (req, res) => {
    const search = typeof req.query.search === 'string' ? req.query.search.slice(0, 200) : undefined;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const includeArchived = req.query.includeArchived === 'true';
    if (status && status !== 'all' && !CLIENT_STATUSES.includes(status)) {
        return safeError(res, new Error('Invalid client status.'), 400);
    }
    const clients = await store_1.store.getClients({ search, status, includeArchived });
    res.json({ clients, total: clients.length });
});
router.get('/clients/:id', async (req, res) => {
    const client = await store_1.store.getClientById(req.params.id);
    if (!client)
        return safeError(res, new Error('Client not found.'), 404);
    const projects = await store_1.store.getProjects({ clientId: client.id });
    const tasks = await store_1.store.getTasks({});
    const projectIds = new Set(projects.map(p => p.id));
    const relatedTasks = tasks.filter(t => t.projectId && projectIds.has(t.projectId));
    const notes = await store_1.store.getNotes('client', client.id);
    const activity = await store_1.store.getActivityLogs('client', client.id, 20);
    res.json({ client, projects, tasks: relatedTasks, notes, activity });
});
router.post('/clients', async (req, res) => {
    const clientName = text(req.body?.clientName, 200);
    if (!clientName)
        return safeError(res, new Error('clientName is required.'), 400);
    const email = optionalText(req.body?.email, 254);
    if (email) {
        const existing = await store_1.store.findClientByEmail(email);
        if (existing)
            return safeError(res, new Error(`A client with email "${email}" already exists.`), 409);
    }
    const status = (req.body?.status || 'new');
    if (!CLIENT_STATUSES.includes(status))
        return safeError(res, new Error('Invalid client status.'), 400);
    const client = await store_1.store.addClient({
        clientName,
        companyName: optionalText(req.body?.companyName, 200),
        email,
        mobile: optionalText(req.body?.mobile, 20),
        whatsapp: optionalText(req.body?.whatsapp, 20),
        businessType: optionalText(req.body?.businessType, 100),
        website: optionalText(req.body?.website, 500),
        city: optionalText(req.body?.city, 100),
        source: optionalText(req.body?.source, 100),
        status,
        notes: optionalText(req.body?.notes, 5000),
        leadId: optionalText(req.body?.leadId, 200) || undefined,
    });
    await store_1.store.addAuditLog({ action: 'client_created', actor: 'owner', targetType: 'client', targetId: client.id });
    res.status(201).json({ success: true, client });
});
router.put('/clients/:id', async (req, res) => {
    const existing = await store_1.store.getClientById(req.params.id);
    if (!existing)
        return safeError(res, new Error('Client not found.'), 404);
    const updates = {};
    if (req.body?.clientName !== undefined) {
        const v = text(req.body.clientName, 200);
        if (!v)
            return safeError(res, new Error('clientName cannot be empty.'), 400);
        updates.clientName = v;
    }
    if (req.body?.status !== undefined) {
        if (!CLIENT_STATUSES.includes(req.body.status))
            return safeError(res, new Error('Invalid status.'), 400);
        updates.status = req.body.status;
    }
    const fields = ['companyName', 'mobile', 'whatsapp', 'businessType', 'website', 'city', 'source', 'notes'];
    for (const f of fields) {
        if (req.body?.[f] !== undefined)
            updates[f] = optionalText(req.body[f], f === 'notes' ? 5000 : 500);
    }
    if (req.body?.email !== undefined) {
        const email = optionalText(req.body.email, 254);
        if (email && email !== existing.email) {
            const dup = await store_1.store.findClientByEmail(email);
            if (dup && dup.id !== existing.id)
                return safeError(res, new Error(`Email "${email}" already in use by another client.`), 409);
        }
        updates.email = email;
    }
    const client = await store_1.store.updateClient(req.params.id, updates);
    if (!client)
        return safeError(res, new Error('Client not found.'), 404);
    await store_1.store.addAuditLog({ action: 'client_updated', actor: 'owner', targetType: 'client', targetId: client.id });
    res.json({ success: true, client });
});
router.post('/clients/:id/archive', async (req, res) => {
    const archived = await store_1.store.archiveClient(req.params.id);
    if (!archived)
        return safeError(res, new Error('Client not found.'), 404);
    await store_1.store.addAuditLog({ action: 'client_archived', actor: 'owner', targetType: 'client', targetId: req.params.id });
    res.json({ success: true });
});
router.delete('/clients/:id', async (req, res) => {
    const deleted = await store_1.store.deleteClient(req.params.id);
    if (!deleted)
        return safeError(res, new Error('Client not found.'), 404);
    await store_1.store.addAuditLog({ action: 'client_deleted', actor: 'owner', targetType: 'client', targetId: req.params.id });
    res.json({ success: true });
});
// Convert lead to client
router.post('/leads/:leadId/convert-to-client', async (req, res) => {
    const lead = await store_1.store.getLeadById(req.params.leadId);
    if (!lead)
        return safeError(res, new Error('Lead not found.'), 404);
    // Prevent duplicate client by email
    if (lead.email) {
        const existing = await store_1.store.findClientByEmail(lead.email);
        if (existing)
            return res.status(409).json({ success: false, error: 'A client with this email already exists.', existingClientId: existing.id });
    }
    const clientName = text(req.body?.clientName, 200) || lead.businessName;
    const client = await store_1.store.addClient({
        clientName,
        companyName: lead.businessName,
        email: lead.email,
        mobile: optionalText(req.body?.mobile, 20),
        whatsapp: optionalText(req.body?.whatsapp, 20),
        businessType: lead.category,
        website: lead.website,
        city: lead.city,
        source: `lead_${lead.id}`,
        status: 'new',
        notes: optionalText(req.body?.notes, 5000),
        leadId: lead.id,
    });
    await store_1.store.addAuditLog({ action: 'lead_converted_to_client', actor: 'owner', targetType: 'client', targetId: client.id, details: { leadId: lead.id } });
    res.status(201).json({ success: true, client });
});
// ─── Projects ─────────────────────────────────────────────────────────────────
router.get('/projects', async (req, res) => {
    const search = typeof req.query.search === 'string' ? req.query.search.slice(0, 200) : undefined;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const clientId = typeof req.query.clientId === 'string' ? req.query.clientId : undefined;
    const includeArchived = req.query.includeArchived === 'true';
    const projects = await store_1.store.getProjects({ search, status, clientId, includeArchived });
    res.json({ projects, total: projects.length });
});
router.get('/projects/:id', async (req, res) => {
    const project = await store_1.store.getProjectById(req.params.id);
    if (!project)
        return safeError(res, new Error('Project not found.'), 404);
    const client = project.clientId ? await store_1.store.getClientById(project.clientId) : null;
    const tasks = await store_1.store.getTasks({ projectId: project.id });
    const notes = await store_1.store.getNotes('project', project.id);
    const activity = await store_1.store.getActivityLogs('project', project.id, 20);
    res.json({ project, client, tasks, notes, activity });
});
router.post('/projects', async (req, res) => {
    const projectName = text(req.body?.projectName, 200);
    if (!projectName)
        return safeError(res, new Error('projectName is required.'), 400);
    const clientId = text(req.body?.clientId, 200) || '';
    if (clientId) {
        const client = await store_1.store.getClientById(clientId);
        if (!client)
            return safeError(res, new Error('Client not found.'), 404);
    }
    const status = (req.body?.status || 'planning');
    if (!PROJECT_STATUSES.includes(status))
        return safeError(res, new Error('Invalid project status.'), 400);
    const priority = (req.body?.priority || 'medium');
    if (!PROJECT_PRIORITIES.includes(priority))
        return safeError(res, new Error('Invalid priority.'), 400);
    const projectType = (req.body?.projectType || 'other');
    if (!PROJECT_TYPES.includes(projectType))
        return safeError(res, new Error('Invalid project type.'), 400);
    const progress = typeof req.body?.progress === 'number' ? Math.min(100, Math.max(0, Math.round(req.body.progress))) : 0;
    const progressMode = req.body?.progressMode === 'auto' ? 'auto' : 'manual';
    const project = await store_1.store.addProject({
        projectName,
        clientId,
        projectType,
        description: optionalText(req.body?.description, 5000),
        techStack: optionalText(req.body?.techStack, 500),
        budget: typeof req.body?.budget === 'number' ? Math.max(0, req.body.budget) : 0,
        startDate: optionalText(req.body?.startDate, 30),
        deadline: optionalText(req.body?.deadline, 30),
        status,
        priority,
        progress,
        progressMode,
        notes: optionalText(req.body?.notes, 5000),
    });
    await store_1.store.addAuditLog({ action: 'project_created', actor: 'owner', targetType: 'project', targetId: project.id });
    res.status(201).json({ success: true, project });
});
router.put('/projects/:id', async (req, res) => {
    const existing = await store_1.store.getProjectById(req.params.id);
    if (!existing)
        return safeError(res, new Error('Project not found.'), 404);
    const updates = {};
    if (req.body?.projectName !== undefined) {
        const v = text(req.body.projectName, 200);
        if (!v)
            return safeError(res, new Error('projectName cannot be empty.'), 400);
        updates.projectName = v;
    }
    if (req.body?.status !== undefined) {
        if (!PROJECT_STATUSES.includes(req.body.status))
            return safeError(res, new Error('Invalid status.'), 400);
        updates.status = req.body.status;
        if (req.body.status === 'completed' && !existing.completedAt)
            updates.completedAt = new Date().toISOString();
    }
    if (req.body?.priority !== undefined) {
        if (!PROJECT_PRIORITIES.includes(req.body.priority))
            return safeError(res, new Error('Invalid priority.'), 400);
        updates.priority = req.body.priority;
    }
    if (req.body?.projectType !== undefined) {
        if (!PROJECT_TYPES.includes(req.body.projectType))
            return safeError(res, new Error('Invalid project type.'), 400);
        updates.projectType = req.body.projectType;
    }
    if (req.body?.progress !== undefined) {
        updates.progress = Math.min(100, Math.max(0, Math.round(Number(req.body.progress))));
    }
    if (req.body?.progressMode !== undefined) {
        updates.progressMode = req.body.progressMode === 'auto' ? 'auto' : 'manual';
    }
    const textFields = ['description', 'techStack', 'notes', 'startDate', 'deadline'];
    for (const f of textFields) {
        if (req.body?.[f] !== undefined)
            updates[f] = optionalText(req.body[f], f === 'description' || f === 'notes' ? 5000 : 500);
    }
    if (req.body?.budget !== undefined)
        updates.budget = Math.max(0, Number(req.body.budget) || 0);
    const project = await store_1.store.updateProject(req.params.id, updates);
    if (!project)
        return safeError(res, new Error('Project not found.'), 404);
    await store_1.store.addAuditLog({ action: 'project_updated', actor: 'owner', targetType: 'project', targetId: project.id });
    res.json({ success: true, project });
});
router.post('/projects/:id/archive', async (req, res) => {
    const archived = await store_1.store.archiveProject(req.params.id);
    if (!archived)
        return safeError(res, new Error('Project not found.'), 404);
    res.json({ success: true });
});
router.delete('/projects/:id', async (req, res) => {
    const deleted = await store_1.store.deleteProject(req.params.id);
    if (!deleted)
        return safeError(res, new Error('Project not found.'), 404);
    await store_1.store.addAuditLog({ action: 'project_deleted', actor: 'owner', targetType: 'project', targetId: req.params.id });
    res.json({ success: true });
});
// Milestones
router.post('/projects/:projectId/milestones', async (req, res) => {
    const title = text(req.body?.title, 200);
    if (!title)
        return safeError(res, new Error('title is required.'), 400);
    const milestone = await store_1.store.addMilestone(req.params.projectId, {
        title,
        description: optionalText(req.body?.description, 2000),
        dueDate: optionalText(req.body?.dueDate, 30) || undefined,
        isCompleted: false,
        order: typeof req.body?.order === 'number' ? req.body.order : 0,
    });
    if (!milestone)
        return safeError(res, new Error('Project not found.'), 404);
    res.status(201).json({ success: true, milestone });
});
router.put('/projects/:projectId/milestones/:milestoneId', async (req, res) => {
    const updates = {};
    if (req.body?.title !== undefined) {
        const v = text(req.body.title, 200);
        if (!v)
            return safeError(res, new Error('title cannot be empty.'), 400);
        updates.title = v;
    }
    if (req.body?.isCompleted !== undefined)
        updates.isCompleted = !!req.body.isCompleted;
    if (req.body?.description !== undefined)
        updates.description = optionalText(req.body.description, 2000);
    if (req.body?.dueDate !== undefined)
        updates.dueDate = optionalText(req.body.dueDate, 30) || undefined;
    if (req.body?.order !== undefined)
        updates.order = Number(req.body.order);
    const milestone = await store_1.store.updateMilestone(req.params.projectId, req.params.milestoneId, updates);
    if (!milestone)
        return safeError(res, new Error('Milestone not found.'), 404);
    res.json({ success: true, milestone });
});
router.delete('/projects/:projectId/milestones/:milestoneId', async (req, res) => {
    const deleted = await store_1.store.deleteMilestone(req.params.projectId, req.params.milestoneId);
    if (!deleted)
        return safeError(res, new Error('Milestone not found.'), 404);
    res.json({ success: true });
});
// ─── Tasks ────────────────────────────────────────────────────────────────────
router.get('/tasks', async (req, res) => {
    const search = typeof req.query.search === 'string' ? req.query.search.slice(0, 200) : undefined;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
    const priority = typeof req.query.priority === 'string' ? req.query.priority : undefined;
    const overdue = req.query.overdue === 'true';
    const today = req.query.today === 'true';
    const tasks = await store_1.store.getTasks({ search, status, projectId, priority, overdue, today });
    res.json({ tasks, total: tasks.length });
});
router.get('/tasks/:id', async (req, res) => {
    const task = await store_1.store.getTaskById(req.params.id);
    if (!task)
        return safeError(res, new Error('Task not found.'), 404);
    const project = task.projectId ? await store_1.store.getProjectById(task.projectId) : null;
    const notes = await store_1.store.getNotes('task', task.id);
    res.json({ task, project, notes });
});
router.post('/tasks', async (req, res) => {
    const title = text(req.body?.title, 300);
    if (!title)
        return safeError(res, new Error('title is required.'), 400);
    const status = (req.body?.status || 'todo');
    if (!TASK_STATUSES.includes(status))
        return safeError(res, new Error('Invalid task status.'), 400);
    const priority = (req.body?.priority || 'medium');
    if (!TASK_PRIORITIES.includes(priority))
        return safeError(res, new Error('Invalid priority.'), 400);
    const checklist = Array.isArray(req.body?.checklist)
        ? req.body.checklist.filter((i) => typeof i.text === 'string' && i.text.trim()).map((i) => ({
            id: `ci_${Math.random().toString(36).slice(2)}`,
            text: i.text.trim().slice(0, 300),
            isChecked: !!i.isChecked,
        }))
        : [];
    const projectId = optionalText(req.body?.projectId, 200) || undefined;
    if (projectId) {
        const project = await store_1.store.getProjectById(projectId);
        if (!project)
            return safeError(res, new Error('Project not found.'), 404);
    }
    const task = await store_1.store.addTask({
        title,
        description: optionalText(req.body?.description, 5000),
        projectId,
        dueDate: optionalText(req.body?.dueDate, 30) || undefined,
        priority,
        status,
        checklist,
        notes: optionalText(req.body?.notes, 5000),
    });
    await store_1.store.addAuditLog({ action: 'task_created', actor: 'owner', targetType: 'task', targetId: task.id });
    res.status(201).json({ success: true, task });
});
router.put('/tasks/:id', async (req, res) => {
    const existing = await store_1.store.getTaskById(req.params.id);
    if (!existing)
        return safeError(res, new Error('Task not found.'), 404);
    const updates = {};
    if (req.body?.title !== undefined) {
        const v = text(req.body.title, 300);
        if (!v)
            return safeError(res, new Error('title cannot be empty.'), 400);
        updates.title = v;
    }
    if (req.body?.status !== undefined) {
        if (!TASK_STATUSES.includes(req.body.status))
            return safeError(res, new Error('Invalid status.'), 400);
        updates.status = req.body.status;
    }
    if (req.body?.priority !== undefined) {
        if (!TASK_PRIORITIES.includes(req.body.priority))
            return safeError(res, new Error('Invalid priority.'), 400);
        updates.priority = req.body.priority;
    }
    if (req.body?.checklist !== undefined) {
        updates.checklist = Array.isArray(req.body.checklist)
            ? req.body.checklist.filter((i) => typeof i.text === 'string' && i.text.trim()).map((i) => ({
                id: i.id || `ci_${Math.random().toString(36).slice(2)}`,
                text: i.text.trim().slice(0, 300),
                isChecked: !!i.isChecked,
            }))
            : [];
    }
    if (req.body?.projectId !== undefined) {
        updates.projectId = optionalText(req.body.projectId, 200) || undefined;
    }
    if (req.body?.dueDate !== undefined)
        updates.dueDate = optionalText(req.body.dueDate, 30) || undefined;
    const textFields = ['description', 'notes'];
    for (const f of textFields) {
        if (req.body?.[f] !== undefined)
            updates[f] = optionalText(req.body[f], 5000);
    }
    const task = await store_1.store.updateTask(req.params.id, updates);
    if (!task)
        return safeError(res, new Error('Task not found.'), 404);
    await store_1.store.addAuditLog({ action: 'task_updated', actor: 'owner', targetType: 'task', targetId: task.id });
    res.json({ success: true, task });
});
router.delete('/tasks/:id', async (req, res) => {
    const deleted = await store_1.store.deleteTask(req.params.id);
    if (!deleted)
        return safeError(res, new Error('Task not found.'), 404);
    await store_1.store.addAuditLog({ action: 'task_deleted', actor: 'owner', targetType: 'task', targetId: req.params.id });
    res.json({ success: true });
});
// ─── Notes ─────────────────────────────────────────────────────────────────
router.get('/notes', async (req, res) => {
    const entityType = typeof req.query.entityType === 'string' ? req.query.entityType : '';
    const entityId = typeof req.query.entityId === 'string' ? req.query.entityId : '';
    if (!['client', 'project', 'task'].includes(entityType) || !entityId) {
        return safeError(res, new Error('entityType and entityId are required.'), 400);
    }
    const notes = await store_1.store.getNotes(entityType, entityId);
    res.json({ notes });
});
router.post('/notes', async (req, res) => {
    const entityType = req.body?.entityType;
    const entityId = text(req.body?.entityId, 200);
    const content = text(req.body?.content, 10000);
    if (!['client', 'project', 'task'].includes(entityType) || !entityId || !content) {
        return safeError(res, new Error('entityType, entityId, and content are required.'), 400);
    }
    const note = await store_1.store.addNote({ entityType, entityId, content });
    res.status(201).json({ success: true, note });
});
router.put('/notes/:id', async (req, res) => {
    const content = text(req.body?.content, 10000);
    if (!content)
        return safeError(res, new Error('content is required.'), 400);
    const note = await store_1.store.updateNote(req.params.id, content);
    if (!note)
        return safeError(res, new Error('Note not found.'), 404);
    res.json({ success: true, note });
});
router.delete('/notes/:id', async (req, res) => {
    const deleted = await store_1.store.deleteNote(req.params.id);
    if (!deleted)
        return safeError(res, new Error('Note not found.'), 404);
    res.json({ success: true });
});
// ─── Activity Logs ─────────────────────────────────────────────────────────
router.get('/activity', async (req, res) => {
    const entityType = typeof req.query.entityType === 'string' ? req.query.entityType : undefined;
    const entityId = typeof req.query.entityId === 'string' ? req.query.entityId : undefined;
    const limit = typeof req.query.limit === 'string' ? Math.min(200, parseInt(req.query.limit) || 50) : 50;
    const logs = await store_1.store.getActivityLogs(entityType, entityId, limit);
    res.json({ logs });
});
exports.default = router;
