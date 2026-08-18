const { direction } = require('./validator');
const { clientIp } = require('./utils');

function createFingerprintController({ service }) {
  const context = (req) => ({
    actor: req.officer?.username || req.user?.username || 'unknown',
    ipAddress: clientIp(req),
    terminal: String(req.body?.terminal || req.get('x-gate-terminal') || 'Gate Officer Dashboard').slice(0, 200)
  });

  return {
    deviceStatus: async (req, res) => {
      res.json({ success: true, ...(await service.deviceStatus()) });
    },
    summary: async (req, res) => {
      res.json(await service.summary());
    },
    status: async (req, res) => {
      res.json(await service.status(req.params.cadetId));
    },
    enroll: async (req, res) => {
      res.status(201).json(await service.enroll({
        cadetId: req.body?.cadetId || req.body?.roll,
        ...context(req)
      }));
    },
    reenroll: async (req, res) => {
      res.json(await service.reenroll({
        cadetId: req.params.cadetId,
        ...context(req)
      }));
    },
    remove: async (req, res) => {
      res.json(await service.remove({
        cadetId: req.params.cadetId,
        ...context(req)
      }));
    },
    verify: async (req, res) => {
      const result = await service.verify({
        cadetId: req.body?.cadetId || req.body?.roll || null,
        direction: direction(req.body?.direction),
        ...context(req)
      });
      res.status(result.success ? 200 : (result.matched ? 403 : 401)).json(result);
    },
    history: async (req, res) => {
      res.json(await service.history({
        limit: req.query?.limit
      }));
    }
  };
}

module.exports = { createFingerprintController };
