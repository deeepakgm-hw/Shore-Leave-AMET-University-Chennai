const express = require('express');
const { FingerprintBridgeClient } = require('./sdk');
const { createFingerprintService } = require('./service');
const { createFingerprintController } = require('./controller');
const {
  allowRoles,
  createRateLimit,
  fingerprintErrorHandler,
  requireFingerprintEncryption
} = require('./middleware');

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function createFingerprintRuntime({ requireOfficer, requireAdmin, Cadet, AuditLog, io, logger, onVerified }) {
  const sdk = new FingerprintBridgeClient({ io, logger });
  const service = createFingerprintService({ Cadet, AuditLog, sdk, io, onVerified });
  const controller = createFingerprintController({ service });

  const enrollmentRoles = allowRoles(['admin', 'duty_officer', 'enrollment_officer']);
  const verificationRoles = allowRoles(['admin', 'duty_officer', 'gate_officer']);
  const statusLimit = createRateLimit({ windowMs: 60_000, max: 120 });
  const captureLimit = createRateLimit({ windowMs: 60_000, max: 15 });
  const verifyLimit = createRateLimit({ windowMs: 60_000, max: 60 });

  const attachSharedMiddleware = (router) => {
    router.use(requireOfficer);
    return router;
  };

  const attachErrorHandler = (router) => {
    router.use(fingerprintErrorHandler);
    return router;
  };

  const fingerprintRouter = attachSharedMiddleware(express.Router());
  fingerprintRouter.get('/device/status', statusLimit, asyncRoute(controller.deviceStatus));
  fingerprintRouter.get('/summary', statusLimit, asyncRoute(controller.summary));
  fingerprintRouter.get('/history', statusLimit, asyncRoute(controller.history));
  fingerprintRouter.get('/status/:cadetId', statusLimit, asyncRoute(controller.status));
  fingerprintRouter.post('/enroll', enrollmentRoles, requireFingerprintEncryption, captureLimit, asyncRoute(controller.enroll));
  fingerprintRouter.post('/verify', verificationRoles, verifyLimit, asyncRoute(controller.verify));
  fingerprintRouter.put('/reenroll/:cadetId', requireAdmin, requireFingerprintEncryption, captureLimit, asyncRoute(controller.reenroll));
  fingerprintRouter.delete('/remove/:cadetId', requireAdmin, captureLimit, asyncRoute(controller.remove));
  attachErrorHandler(fingerprintRouter);

  const biometricRouter = attachSharedMiddleware(express.Router());
  biometricRouter.get('/device/status', statusLimit, asyncRoute(controller.deviceStatus));
  biometricRouter.get('/summary', statusLimit, asyncRoute(controller.summary));
  biometricRouter.get('/history', statusLimit, asyncRoute(controller.history));
  biometricRouter.get('/fingerprint/device/status', statusLimit, asyncRoute(controller.deviceStatus));
  biometricRouter.get('/fingerprint/summary', statusLimit, asyncRoute(controller.summary));
  biometricRouter.get('/fingerprint/history', statusLimit, asyncRoute(controller.history));
  biometricRouter.get('/fingerprint/status/:cadetId', statusLimit, asyncRoute(controller.status));
  biometricRouter.post('/fingerprint/enroll', enrollmentRoles, requireFingerprintEncryption, captureLimit, asyncRoute(controller.enroll));
  biometricRouter.post('/fingerprint/verify', verificationRoles, verifyLimit, asyncRoute(controller.verify));
  biometricRouter.put('/fingerprint/reenroll/:cadetId', requireAdmin, requireFingerprintEncryption, captureLimit, asyncRoute(controller.reenroll));
  biometricRouter.delete('/fingerprint/remove/:cadetId', requireAdmin, captureLimit, asyncRoute(controller.remove));
  attachErrorHandler(biometricRouter);

  sdk.startHeartbeat();
  return {
    fingerprintRouter,
    biometricRouter,
    status: () => sdk.status()
  };
}

function createFingerprintRouter(options) {
  return createFingerprintRuntime(options).fingerprintRouter;
}

module.exports = { createFingerprintRouter, createFingerprintRuntime };
