import { nanoid } from 'nanoid';
import type { FastifyInstance } from 'fastify';
import { groupFromPath, type CordonRequest, type DrainRequest, type RolloutRestartRequest, type ScaleRequest, type SetImageRequest, type SuspendCronJobRequest, type TriggerCronJobRequest } from '@kubedeck/shared';
import type { AppContext } from '../app.js';
import { drainNode, rolloutRestart, scaleResource, setCordon, setCronJobSuspend, setImage, triggerCronJob, type DrainProgress } from '../kube/actions.js';
import { sendError } from '../util/errors.js';
import { broadcastWatchMessage } from '../ws/watch-socket.js';

export function registerActionRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post<{ Params: { ctx: string }; Body: ScaleRequest }>('/api/contexts/:ctx/actions/scale', async (req, reply) => {
    try {
      const handle = ctx.clusters.get(req.params.ctx);
      const b = req.body;
      await scaleResource(handle, groupFromPath(b.group), b.version, b.plural, b.namespace, b.name, b.replicas);
      return { ok: true };
    } catch (err) {
      sendError(reply, err);
      return reply;
    }
  });

  app.post<{ Params: { ctx: string }; Body: RolloutRestartRequest }>('/api/contexts/:ctx/actions/rollout-restart', async (req, reply) => {
    try {
      const handle = ctx.clusters.get(req.params.ctx);
      await rolloutRestart(handle, req.body.kind, req.body.namespace, req.body.name);
      return { ok: true };
    } catch (err) {
      sendError(reply, err);
      return reply;
    }
  });

  app.post<{ Params: { ctx: string }; Body: CordonRequest }>('/api/contexts/:ctx/actions/cordon', async (req, reply) => {
    try {
      const handle = ctx.clusters.get(req.params.ctx);
      await setCordon(handle, req.body.node, req.body.unschedulable);
      return { ok: true };
    } catch (err) {
      sendError(reply, err);
      return reply;
    }
  });

  app.post<{ Params: { ctx: string }; Body: TriggerCronJobRequest }>('/api/contexts/:ctx/actions/trigger-cronjob', async (req, reply) => {
    try {
      const handle = ctx.clusters.get(req.params.ctx);
      return await triggerCronJob(handle, req.body.namespace, req.body.name);
    } catch (err) {
      sendError(reply, err);
      return reply;
    }
  });

  app.post<{ Params: { ctx: string }; Body: SuspendCronJobRequest }>('/api/contexts/:ctx/actions/suspend-cronjob', async (req, reply) => {
    try {
      const handle = ctx.clusters.get(req.params.ctx);
      await setCronJobSuspend(handle, req.body.namespace, req.body.name, req.body.suspend);
      return { ok: true };
    } catch (err) {
      sendError(reply, err);
      return reply;
    }
  });

  app.post<{ Params: { ctx: string }; Body: SetImageRequest }>('/api/contexts/:ctx/actions/set-image', async (req, reply) => {
    try {
      const handle = ctx.clusters.get(req.params.ctx);
      await setImage(handle, req.body);
      return { ok: true };
    } catch (err) {
      sendError(reply, err);
      return reply;
    }
  });

  app.post<{ Params: { ctx: string }; Body: DrainRequest }>('/api/contexts/:ctx/actions/drain', async (req, reply) => {
    try {
      const handle = ctx.clusters.get(req.params.ctx);
      const drainId = nanoid(10);
      const report = (p: DrainProgress) => {
        broadcastWatchMessage({ op: 'drain-progress', drainId, evicted: p.evicted, total: p.total, current: p.current, done: p.done, error: p.error });
      };
      // Run async; progress + completion stream over the watch socket.
      void drainNode(handle, req.body.node, { gracePeriodSeconds: req.body.gracePeriodSeconds, force: req.body.force }, report).catch((err) => {
        app.log.warn({ err: String(err) }, 'drain failed');
        broadcastWatchMessage({ op: 'drain-progress', drainId, evicted: 0, total: 0, done: true, error: err instanceof Error ? err.message : String(err) });
      });
      return { drainId };
    } catch (err) {
      sendError(reply, err);
      return reply;
    }
  });
}
