"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.app = void 0;
exports.startServer = startServer;
require("./config");
require("express-async-errors");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const config_1 = require("./config");
const api_1 = __importDefault(require("./routes/api"));
const phase2_1 = __importDefault(require("./routes/phase2"));
const phase3_1 = __importDefault(require("./routes/phase3"));
const phase4_1 = __importDefault(require("./routes/phase4"));
const schedulerService_1 = require("./services/schedulerService");
const logger_1 = require("./utils/logger");
exports.app = (0, express_1.default)();
exports.app.disable('x-powered-by');
if (config_1.config.nodeEnv === 'production')
    exports.app.set('trust proxy', 1);
exports.app.use((0, cors_1.default)({
    origin(origin, callback) {
        if (!origin || config_1.config.corsOrigins.includes(origin))
            callback(null, true);
        else
            callback(new Error('Origin is not allowed by CORS policy.'));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600,
}));
exports.app.use(express_1.default.json({ limit: config_1.config.requestBodyLimit, strict: true }));
exports.app.use(express_1.default.urlencoded({ extended: false, limit: '64kb' }));
exports.app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => logger_1.logger.info('http_request', {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Date.now() - start,
    }));
    next();
});
const health = (_req, res) => res.json({
    service: 'Arclivo Labs AI Email Automation API',
    status: 'online',
    version: '1.1.0',
    timestamp: new Date().toISOString(),
});
exports.app.get('/', health);
exports.app.get('/healthz', health);
exports.app.use('/api', api_1.default);
exports.app.use('/api', phase2_1.default);
exports.app.use('/api', phase3_1.default);
exports.app.use('/api', phase4_1.default);
exports.app.use((_req, res) => res.status(404).json({ error: 'Route not found.' }));
exports.app.use((error, _req, res, _next) => {
    logger_1.logger.error('request_failed', { message: error?.message || 'unknown' });
    if (error?.type === 'entity.too.large') {
        res.status(413).json({ error: 'Request body is too large.' });
        return;
    }
    if (error instanceof SyntaxError) {
        res.status(400).json({ error: 'Malformed JSON request.' });
        return;
    }
    if (error?.message === 'Origin is not allowed by CORS policy.') {
        res.status(403).json({ error: 'Origin is not allowed.' });
        return;
    }
    res.status(500).json({ error: 'Internal server error.' });
});
function startServer() {
    (0, config_1.assertSafeStartup)();
    const server = exports.app.listen(config_1.config.port, () => {
        logger_1.logger.info('server_started', { port: config_1.config.port, environment: config_1.config.nodeEnv });
        schedulerService_1.SchedulerService.start();
    });
    const shutdown = (signal) => {
        logger_1.logger.info('shutdown_started', { signal });
        schedulerService_1.SchedulerService.stop();
        const timeout = setTimeout(() => {
            logger_1.logger.error('shutdown_forced');
            process.exit(1);
        }, 10_000);
        timeout.unref();
        server.close(error => {
            if (error) {
                logger_1.logger.error('shutdown_failed', { message: error.message });
                process.exitCode = 1;
            }
            clearTimeout(timeout);
        });
    };
    process.once('SIGINT', () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));
    return server;
}
if (require.main === module)
    startServer();
exports.default = exports.app;
