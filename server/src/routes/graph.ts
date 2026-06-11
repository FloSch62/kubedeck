import type { FastifyInstance } from 'fastify';
import type { GraphEdge, GraphNode, GraphNodeStatus, KubeObject, RelationshipGraph, ResourceRef } from '@kubedeck/shared';
import type { AppContext } from '../app.js';
import type { ClusterHandle } from '../kube/cluster-manager.js';
import { resourcePath } from '../kube/raw-client.js';
import { sendError } from '../util/errors.js';

interface KindSpec {
  group: string;
  version: string;
  plural: string;
  kind: string;
  namespaced: boolean;
  layer: GraphNode['layer'];
}

const KINDS: KindSpec[] = [
  { group: 'networking.k8s.io', version: 'v1', plural: 'ingresses', kind: 'Ingress', namespaced: true, layer: 'entry' },
  { group: '', version: 'v1', plural: 'services', kind: 'Service', namespaced: true, layer: 'service' },
  { group: 'apps', version: 'v1', plural: 'deployments', kind: 'Deployment', namespaced: true, layer: 'workload' },
  { group: 'apps', version: 'v1', plural: 'statefulsets', kind: 'StatefulSet', namespaced: true, layer: 'workload' },
  { group: 'apps', version: 'v1', plural: 'daemonsets', kind: 'DaemonSet', namespaced: true, layer: 'workload' },
  { group: 'batch', version: 'v1', plural: 'cronjobs', kind: 'CronJob', namespaced: true, layer: 'workload' },
  { group: 'batch', version: 'v1', plural: 'jobs', kind: 'Job', namespaced: true, layer: 'workload' },
  { group: 'apps', version: 'v1', plural: 'replicasets', kind: 'ReplicaSet', namespaced: true, layer: 'replicaset' },
  { group: '', version: 'v1', plural: 'pods', kind: 'Pod', namespaced: true, layer: 'pod' },
  { group: '', version: 'v1', plural: 'configmaps', kind: 'ConfigMap', namespaced: true, layer: 'storage' },
  { group: '', version: 'v1', plural: 'secrets', kind: 'Secret', namespaced: true, layer: 'storage' },
  { group: '', version: 'v1', plural: 'persistentvolumeclaims', kind: 'PersistentVolumeClaim', namespaced: true, layer: 'storage' },
  { group: '', version: 'v1', plural: 'persistentvolumes', kind: 'PersistentVolume', namespaced: false, layer: 'storage' },
  { group: '', version: 'v1', plural: 'nodes', kind: 'Node', namespaced: false, layer: 'node' },
];

interface Item {
  spec: KindSpec;
  obj: KubeObject;
}

interface LabelSelector {
  matchLabels?: Record<string, string>;
}

interface FocusQuery {
  namespace?: string;
  focusGroup?: string;
  focusVersion?: string;
  focusPlural?: string;
  focusKind?: string;
  focusNamespace?: string;
  focusName?: string;
  depth?: string;
}

function ref(ctx: string, spec: KindSpec, obj: KubeObject): ResourceRef {
  return {
    ctx,
    group: spec.group,
    version: spec.version,
    plural: spec.plural,
    kind: spec.kind,
    name: obj.metadata.name,
    namespace: obj.metadata.namespace,
    uid: obj.metadata.uid,
  };
}

function nodeId(ctx: string, spec: KindSpec, obj: KubeObject): string {
  return `${ctx}|${spec.group}|${spec.version}|${spec.plural}|${obj.metadata.namespace ?? ''}|${obj.metadata.name}`;
}

function statusFor(kind: string, obj: KubeObject): { status: GraphNodeStatus; reason?: string } {
  const st = obj.status ?? {};
  const sp = obj.spec ?? {};
  if (kind === 'Pod') {
    const phase = st.phase as string | undefined;
    const statuses = (st.containerStatuses ?? []) as Array<{ restartCount?: number; state?: { waiting?: { reason?: string; message?: string } } }>;
    const waiting = statuses.find((c) => c.state?.waiting?.reason)?.state?.waiting;
    if (phase === 'Failed') return { status: 'error', reason: (st.reason as string | undefined) ?? 'Failed' };
    if (waiting?.reason && ['CrashLoopBackOff', 'ImagePullBackOff', 'ErrImagePull', 'CreateContainerConfigError', 'CreateContainerError'].includes(waiting.reason)) {
      return { status: 'error', reason: waiting.reason };
    }
    if (phase === 'Pending') return { status: 'warning', reason: waiting?.reason ?? 'Pending' };
    if (phase === 'Running') return { status: 'success' };
    return { status: 'unknown', reason: phase };
  }
  if (kind === 'Deployment' || kind === 'StatefulSet' || kind === 'ReplicaSet') {
    const desired = (sp.replicas as number | undefined) ?? 1;
    const ready = (st.readyReplicas as number | undefined) ?? (st.availableReplicas as number | undefined) ?? 0;
    return ready >= desired ? { status: 'success' } : { status: desired > 0 ? 'warning' : 'unknown', reason: `${ready}/${desired} ready` };
  }
  if (kind === 'DaemonSet') {
    const desired = (st.desiredNumberScheduled as number | undefined) ?? 0;
    const ready = (st.numberReady as number | undefined) ?? 0;
    return ready >= desired ? { status: 'success' } : { status: 'warning', reason: `${ready}/${desired} ready` };
  }
  if (kind === 'Job') {
    if ((st.failed as number | undefined) && !st.active) return { status: 'error', reason: `${st.failed} failed` };
    if ((st.succeeded as number | undefined) && !st.active) return { status: 'success' };
    return { status: 'unknown' };
  }
  if (kind === 'PersistentVolume' || kind === 'PersistentVolumeClaim') {
    const phase = st.phase as string | undefined;
    if (phase === 'Bound') return { status: 'success' };
    if (phase === 'Failed' || phase === 'Lost') return { status: 'error', reason: phase };
    if (phase) return { status: 'warning', reason: phase };
  }
  if (kind === 'Node') {
    const ready = ((st.conditions ?? []) as Array<{ type?: string; status?: string }>).find((c) => c.type === 'Ready')?.status;
    if (ready === 'True') return { status: 'success' };
    if (ready === 'False') return { status: 'error', reason: 'NotReady' };
    return { status: 'unknown' };
  }
  return { status: 'unknown' };
}

function sublabel(kind: string, obj: KubeObject): string | undefined {
  if (kind === 'Pod') return obj.metadata.namespace;
  if (kind === 'Service') return `${obj.metadata.namespace ?? ''} · ${(obj.spec?.type as string | undefined) ?? 'ClusterIP'}`;
  if (kind === 'Ingress') return obj.metadata.namespace;
  if (kind === 'Node') return (obj.status?.nodeInfo as { kubeletVersion?: string } | undefined)?.kubeletVersion;
  if (obj.metadata.namespace) return obj.metadata.namespace;
  return undefined;
}

function selectorMatches(selector: Record<string, string> | undefined, labels: Record<string, string> | undefined): boolean {
  const entries = Object.entries(selector ?? {});
  return entries.length > 0 && entries.every(([k, v]) => labels?.[k] === v);
}

async function listKind(handle: ClusterHandle, spec: KindSpec, namespaces: Set<string> | undefined, warnings: string[]): Promise<Item[]> {
  try {
    const query = new URLSearchParams({ limit: '2000' });
    const namespace = spec.namespaced && namespaces?.size === 1 ? [...namespaces][0] : undefined;
    const list = await handle.raw.json<{ items?: KubeObject[] }>(resourcePath(spec.group, spec.version, spec.plural, { namespace, query }));
    const items = (list.items ?? []).filter((obj) => !spec.namespaced || !namespaces?.size || namespaces.has(obj.metadata.namespace ?? ''));
    return items.map((obj) => ({ spec, obj }));
  } catch (err) {
    warnings.push(`${spec.kind}: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

function addEdge(edges: GraphEdge[], source: string | undefined, target: string | undefined, kind: GraphEdge['kind'], label?: string): boolean {
  if (!source || !target || source === target) return false;
  const id = `${source}->${target}:${kind}:${label ?? ''}`;
  if (edges.some((e) => e.id === id)) return true;
  edges.push({ id, source, target, kind, label });
  return true;
}

function setNodeStatus(nodes: Map<string, GraphNode>, id: string | undefined, status: GraphNodeStatus, reason: string): void {
  if (!id) return;
  const node = nodes.get(id);
  if (!node) return;
  if (node.status !== 'error' || status === 'error') {
    node.status = status;
    node.reason = reason;
  }
}

function appName(obj: KubeObject): string | undefined {
  const labels = obj.metadata.labels ?? {};
  return labels['app.kubernetes.io/instance'] ?? labels['app.kubernetes.io/name'] ?? labels.app;
}

function matchesFocus(node: GraphNode, query: FocusQuery): boolean {
  if (query.focusGroup !== undefined && node.ref.group !== query.focusGroup) return false;
  if (query.focusVersion && node.ref.version !== query.focusVersion) return false;
  if (query.focusPlural && node.ref.plural !== query.focusPlural) return false;
  if (query.focusKind && node.ref.kind !== query.focusKind) return false;
  if (query.focusNamespace !== undefined && (node.ref.namespace ?? '') !== query.focusNamespace) return false;
  if (query.focusName && node.ref.name !== query.focusName) return false;
  return !!query.focusName || !!query.focusKind || !!query.focusPlural;
}

function focusGraph(graph: RelationshipGraph, query: FocusQuery): RelationshipGraph {
  const focus = graph.nodes.find((node) => matchesFocus(node, query));
  const hasFocusQuery = !!query.focusName || !!query.focusKind || !!query.focusPlural;
  if (!focus) {
    return hasFocusQuery
      ? { ...graph, nodes: [], edges: [], warnings: [...graph.warnings, `No topology data found for ${query.focusKind ?? 'resource'} ${query.focusNamespace ? `${query.focusNamespace}/` : ''}${query.focusName ?? ''}.`] }
      : graph;
  }
  const depth = Math.max(1, Math.min(4, Number(query.depth ?? 2)));
  const adjacency = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    adjacency.set(edge.source, new Set([...(adjacency.get(edge.source) ?? []), edge.target]));
    adjacency.set(edge.target, new Set([...(adjacency.get(edge.target) ?? []), edge.source]));
  }
  const keep = new Set<string>([focus.id]);
  let frontier = new Set<string>([focus.id]);
  for (let i = 0; i < depth; i++) {
    const next = new Set<string>();
    for (const id of frontier) {
      for (const neighbor of adjacency.get(id) ?? []) {
        if (keep.has(neighbor)) continue;
        keep.add(neighbor);
        next.add(neighbor);
      }
    }
    frontier = next;
  }
  return {
    ...graph,
    nodes: graph.nodes.filter((node) => keep.has(node.id)),
    edges: graph.edges.filter((edge) => keep.has(edge.source) && keep.has(edge.target)),
  };
}

async function buildGraph(handle: ClusterHandle, query: FocusQuery): Promise<RelationshipGraph> {
  const namespaces = query.namespace ? new Set(query.namespace.split(',').map((n) => n.trim()).filter(Boolean)) : undefined;
  const warnings: string[] = [];
  const items = (await Promise.all(KINDS.map((spec) => listKind(handle, spec, namespaces, warnings)))).flat();

  const nodes = new Map<string, GraphNode>(items.map(({ spec, obj }) => {
    const status = statusFor(spec.kind, obj);
    const id = nodeId(handle.contextName, spec, obj);
    const app = appName(obj);
    return [id, {
      id: nodeId(handle.contextName, spec, obj),
      ref: ref(handle.contextName, spec, obj),
      label: obj.metadata.name,
      sublabel: app ? `${sublabel(spec.kind, obj) ?? ''} · app ${app}` : sublabel(spec.kind, obj),
      layer: spec.layer,
      status: status.status,
      reason: status.reason,
    }];
  }));

  const byUid = new Map<string, string>();
  const byKindName = new Map<string, string>();
  const byKindNsName = new Map<string, string>();
  const nodeItems = new Map<string, Item>();
  for (const item of items) {
    const id = nodeId(handle.contextName, item.spec, item.obj);
    nodeItems.set(id, item);
    if (item.obj.metadata.uid) byUid.set(item.obj.metadata.uid, id);
    byKindName.set(`${item.spec.kind}|${item.obj.metadata.name}`, id);
    byKindNsName.set(`${item.spec.kind}|${item.obj.metadata.namespace ?? ''}|${item.obj.metadata.name}`, id);
  }

  const edges: GraphEdge[] = [];
  for (const [id, { obj }] of nodeItems) {
    for (const owner of obj.metadata.ownerReferences ?? []) {
      addEdge(edges, byUid.get(owner.uid), id, 'owns', owner.kind);
    }
  }

  const pods = items.filter((i) => i.spec.kind === 'Pod');
  for (const svc of items.filter((i) => i.spec.kind === 'Service')) {
    const svcId = nodeId(handle.contextName, svc.spec, svc.obj);
    const selector = svc.obj.spec?.selector as Record<string, string> | undefined;
    let matched = 0;
    for (const pod of pods) {
      if (svc.obj.metadata.namespace === pod.obj.metadata.namespace && selectorMatches(selector, pod.obj.metadata.labels)) {
        matched++;
        addEdge(edges, svcId, nodeId(handle.contextName, pod.spec, pod.obj), 'selects');
      }
    }
    if (selector && !matched) {
      setNodeStatus(nodes, svcId, 'warning', 'selector matches 0 pods');
      warnings.push(`Service ${svc.obj.metadata.namespace}/${svc.obj.metadata.name} selector matches 0 pods.`);
    } else if (matched > 0) {
      setNodeStatus(nodes, svcId, 'success', `${matched} pod${matched === 1 ? '' : 's'}`);
    }
  }

  for (const ing of items.filter((i) => i.spec.kind === 'Ingress')) {
    const ingId = nodeId(handle.contextName, ing.spec, ing.obj);
    const spec = ing.obj.spec as {
      defaultBackend?: { service?: { name?: string } };
      rules?: Array<{ http?: { paths?: Array<{ backend?: { service?: { name?: string; port?: { name?: string; number?: number } } } }> } }>;
    } | undefined;
    const names = new Set<string>();
    if (spec?.defaultBackend?.service?.name) names.add(spec.defaultBackend.service.name);
    for (const rule of spec?.rules ?? []) {
      for (const path of rule.http?.paths ?? []) {
        if (path.backend?.service?.name) names.add(path.backend.service.name);
      }
    }
    for (const name of names) {
      const target = byKindNsName.get(`Service|${ing.obj.metadata.namespace ?? ''}|${name}`);
      if (!addEdge(edges, ingId, target, 'routes')) {
        setNodeStatus(nodes, ingId, 'warning', `missing Service/${name}`);
        warnings.push(`Ingress ${ing.obj.metadata.namespace}/${ing.obj.metadata.name} points to missing Service ${name}.`);
      }
    }
  }

  for (const pod of pods) {
    const podId = nodeId(handle.contextName, pod.spec, pod.obj);
    const spec = pod.obj.spec as {
      nodeName?: string;
      volumes?: Array<{ persistentVolumeClaim?: { claimName?: string }; configMap?: { name?: string }; secret?: { secretName?: string } }>;
    } | undefined;
    if (spec?.nodeName) addEdge(edges, podId, byKindName.get(`Node|${spec.nodeName}`), 'schedules');
    for (const vol of spec?.volumes ?? []) {
      const claim = vol.persistentVolumeClaim?.claimName;
      if (claim && !addEdge(edges, podId, byKindNsName.get(`PersistentVolumeClaim|${pod.obj.metadata.namespace ?? ''}|${claim}`), 'mounts')) {
        setNodeStatus(nodes, podId, 'warning', `missing PVC/${claim}`);
        warnings.push(`Pod ${pod.obj.metadata.namespace}/${pod.obj.metadata.name} mounts missing PVC ${claim}.`);
      }
      const configMap = vol.configMap?.name;
      if (configMap && !addEdge(edges, podId, byKindNsName.get(`ConfigMap|${pod.obj.metadata.namespace ?? ''}|${configMap}`), 'mounts')) {
        setNodeStatus(nodes, podId, 'warning', `missing ConfigMap/${configMap}`);
        warnings.push(`Pod ${pod.obj.metadata.namespace}/${pod.obj.metadata.name} mounts missing ConfigMap ${configMap}.`);
      }
      const secret = vol.secret?.secretName;
      if (secret && !addEdge(edges, podId, byKindNsName.get(`Secret|${pod.obj.metadata.namespace ?? ''}|${secret}`), 'mounts')) {
        setNodeStatus(nodes, podId, 'warning', `missing Secret/${secret}`);
        warnings.push(`Pod ${pod.obj.metadata.namespace}/${pod.obj.metadata.name} mounts missing Secret ${secret}.`);
      }
    }
  }

  for (const pvc of items.filter((i) => i.spec.kind === 'PersistentVolumeClaim')) {
    const volumeName = pvc.obj.spec?.volumeName as string | undefined;
    const pvcId = nodeId(handle.contextName, pvc.spec, pvc.obj);
    if (volumeName && !addEdge(edges, pvcId, byKindName.get(`PersistentVolume|${volumeName}`), 'binds')) {
      setNodeStatus(nodes, pvcId, 'warning', `missing PV/${volumeName}`);
      warnings.push(`PVC ${pvc.obj.metadata.namespace}/${pvc.obj.metadata.name} references missing PV ${volumeName}.`);
    }
  }

  return focusGraph({ ctx: handle.contextName, nodes: [...nodes.values()], edges, warnings }, query);
}

export function registerGraphRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get<{ Params: { ctx: string }; Querystring: FocusQuery }>('/api/contexts/:ctx/graph', async (req, reply) => {
    try {
      const handle = ctx.clusters.get(req.params.ctx);
      return await buildGraph(handle, req.query);
    } catch (err) {
      sendError(reply, err);
      return reply;
    }
  });
}
