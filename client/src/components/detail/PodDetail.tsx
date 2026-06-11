import { useState } from 'react';
import { Box, Chip, CircularProgress, FormControlLabel, Link, Stack, Switch, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import type { KubeObject, PodEnvVar } from '@kubedeck/shared';
import { gvkForKind } from '@kubedeck/shared';
import { GenericDetail, KeyValueChips } from './GenericDetail.js';
import { StatusChip } from '../StatusChip.js';
import { podSummary } from '../../kube-display.js';
import { usePodEnv } from '../../api/queries.js';
import { useDetailStore } from '../../state/detail.js';

interface ContainerSpec {
  name: string;
  image?: string;
  ports?: Array<{ containerPort: number; protocol?: string }>;
  volumeMounts?: Array<{ name: string; mountPath: string; readOnly?: boolean; subPath?: string }>;
}

interface ContainerStatus {
  name: string;
  ready?: boolean;
  restartCount?: number;
  state?: Record<string, { reason?: string }>;
}

interface VolumeSpec {
  name: string;
  [key: string]: unknown;
}

interface Toleration {
  key?: string;
  operator?: string;
  value?: string;
  effect?: string;
  tolerationSeconds?: number;
}

interface PodSpec {
  containers?: ContainerSpec[];
  initContainers?: ContainerSpec[];
  nodeName?: string;
  volumes?: VolumeSpec[];
  nodeSelector?: Record<string, string>;
  tolerations?: Toleration[];
}

export function PodDetail({ obj, ctx }: { obj: KubeObject; ctx: string }) {
  const spec = obj.spec as PodSpec | undefined;
  const status = obj.status as { podIP?: string; containerStatuses?: ContainerStatus[]; qosClass?: string } | undefined;
  const summary = podSummary(obj);
  const statusByName = new Map((status?.containerStatuses ?? []).map((c) => [c.name, c]));
  const push = useDetailStore((s) => s.push);
  const namespace = obj.metadata.namespace;

  const openRelated = (kind: 'Node' | 'ConfigMap' | 'Secret' | 'PersistentVolumeClaim', name: string) => {
    const gvk = gvkForKind(kind);
    if (!gvk) return;
    push({ ctx, group: gvk.group, version: gvk.version, plural: gvk.plural, kind, name, namespace: gvk.namespaced ? namespace : undefined });
  };

  return (
    <Box>
      <Stack direction="row" spacing={1} sx={{ px: 2, pt: 2, flexWrap: 'wrap' }}>
        <StatusChip status={summary.status} />
        <Chip label={`Ready ${summary.ready}`} variant="outlined" />
        <Chip label={`Restarts ${summary.restarts}`} variant="outlined" />
        {status?.podIP && <Chip label={`IP ${status.podIP}`} variant="outlined" />}
        {spec?.nodeName && (
          <Chip label={`Node ${spec.nodeName}`} variant="outlined" clickable onClick={() => openRelated('Node', spec.nodeName!)} />
        )}
        {status?.qosClass && <Chip label={`QoS ${status.qosClass}`} variant="outlined" />}
      </Stack>
      <Box sx={{ px: 2, pt: 2 }}>
        <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
          Containers
        </Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Image</TableCell>
              <TableCell>State</TableCell>
              <TableCell>Restarts</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {[...(spec?.initContainers ?? []).map((c) => ({ ...c, init: true })), ...(spec?.containers ?? []).map((c) => ({ ...c, init: false }))].map((c) => {
              const st = statusByName.get(c.name);
              const stateKey = st?.state ? Object.keys(st.state)[0] : undefined;
              const reason = stateKey ? (st!.state![stateKey]?.reason ?? stateKey) : '';
              return (
                <TableRow key={c.name}>
                  <TableCell>
                    {c.name}
                    {c.init && <Chip label="init" sx={{ ml: 0.5, height: 16, fontSize: 10 }} />}
                  </TableCell>
                  <TableCell sx={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis' }} title={c.image}>
                    {c.image}
                  </TableCell>
                  <TableCell>
                    <StatusChip status={reason === 'running' ? 'Running' : reason} />
                  </TableCell>
                  <TableCell>{st?.restartCount ?? 0}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Box>
      {namespace && <EnvSection ctx={ctx} namespace={namespace} pod={obj.metadata.name} onOpenRef={openRelated} />}
      <VolumesSection spec={spec} onOpenRef={openRelated} />
      <SchedulingSection spec={spec} />
      <GenericDetail obj={obj} ctx={ctx} />
    </Box>
  );
}

type RefOpener = (kind: 'Node' | 'ConfigMap' | 'Secret' | 'PersistentVolumeClaim', name: string) => void;

function envSourceLabel(env: PodEnvVar): { text: string; refKind?: 'ConfigMap' | 'Secret'; refName?: string } {
  const s = env.source;
  if (!s || s.type === 'literal') return { text: '' };
  if (s.type === 'fieldRef') return { text: `field ${s.key ?? ''}` };
  if (s.type === 'resourceFieldRef') return { text: `resource ${s.key ?? ''}` };
  const isSecret = s.type === 'secretKeyRef' || s.type === 'secretRef';
  const base = `${isSecret ? 'secret' : 'configmap'}/${s.ref ?? ''}`;
  return { text: s.key && s.type !== 'configMapRef' && s.type !== 'secretRef' ? `${base} → ${s.key}` : base, refKind: isSecret ? 'Secret' : 'ConfigMap', refName: s.ref };
}

function EnvSection({ ctx, namespace, pod, onOpenRef }: { ctx: string; namespace: string; pod: string; onOpenRef: RefOpener }) {
  const [reveal, setReveal] = useState(false);
  const { data, isLoading } = usePodEnv({ ctx, namespace, name: pod, reveal });
  const containers = (data?.containers ?? []).filter((c) => c.env.length > 0);
  const hasSecrets = containers.some((c) => c.env.some((e) => e.redacted));
  if (!isLoading && containers.length === 0) return null;

  return (
    <Box sx={{ px: 2, pt: 2 }}>
      <Stack direction="row" alignItems="center" sx={{ mb: 0.5 }}>
        <Typography variant="subtitle2">Environment</Typography>
        <Box sx={{ flex: 1 }} />
        {hasSecrets && (
          <FormControlLabel
            control={<Switch size="small" checked={reveal} onChange={(e) => setReveal(e.target.checked)} />}
            label={<Typography variant="caption">Reveal secret values</Typography>}
          />
        )}
      </Stack>
      {isLoading && <CircularProgress size={18} />}
      {containers.map((c) => (
        <Box key={`${c.init ? 'i' : 'c'}:${c.name}`} sx={{ mb: 1.5 }}>
          {containers.length > 1 && (
            <Typography variant="caption" color="text.secondary">
              {c.name}
              {c.init ? ' (init)' : ''}
            </Typography>
          )}
          <Table size="small">
            <TableBody>
              {c.env.map((env, i) => {
                const source = envSourceLabel(env);
                return (
                  <TableRow key={`${env.name}:${i}`}>
                    <TableCell sx={{ width: 220, fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' }}>{env.name}</TableCell>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: 12, maxWidth: 280, wordBreak: 'break-all' }}>
                      {env.error ? (
                        <Typography component="span" variant="caption" color="warning.main">
                          {env.error}
                        </Typography>
                      ) : (
                        (env.value ?? '')
                      )}
                    </TableCell>
                    <TableCell sx={{ width: 200 }}>
                      {source.refKind && source.refName ? (
                        <Link component="button" variant="caption" color="text.secondary" sx={{ textAlign: 'left' }} onClick={() => onOpenRef(source.refKind!, source.refName!)}>
                          {source.text}
                        </Link>
                      ) : (
                        <Typography variant="caption" color="text.secondary">
                          {source.text}
                        </Typography>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Box>
      ))}
    </Box>
  );
}

/** Human label + navigable reference for a pod volume. */
function volumeInfo(v: VolumeSpec): { type: string; detail?: string; refKind?: 'ConfigMap' | 'Secret' | 'PersistentVolumeClaim'; refName?: string } {
  if (v.persistentVolumeClaim) {
    const claim = (v.persistentVolumeClaim as { claimName?: string }).claimName;
    return { type: 'persistentVolumeClaim', detail: claim, refKind: 'PersistentVolumeClaim', refName: claim };
  }
  if (v.configMap) {
    const name = (v.configMap as { name?: string }).name;
    return { type: 'configMap', detail: name, refKind: 'ConfigMap', refName: name };
  }
  if (v.secret) {
    const name = (v.secret as { secretName?: string }).secretName;
    return { type: 'secret', detail: name, refKind: 'Secret', refName: name };
  }
  if (v.hostPath) return { type: 'hostPath', detail: (v.hostPath as { path?: string }).path };
  const type = Object.keys(v).find((k) => k !== 'name') ?? 'unknown';
  return { type };
}

function VolumesSection({ spec, onOpenRef }: { spec: PodSpec | undefined; onOpenRef: RefOpener }) {
  const volumes = spec?.volumes ?? [];
  if (!volumes.length) return null;
  const allContainers = [...(spec?.initContainers ?? []), ...(spec?.containers ?? [])];
  const mountsByVolume = new Map<string, string[]>();
  for (const c of allContainers) {
    for (const m of c.volumeMounts ?? []) {
      const entry = `${c.name}: ${m.mountPath}${m.subPath ? ` (subPath ${m.subPath})` : ''}${m.readOnly ? ' (ro)' : ''}`;
      mountsByVolume.set(m.name, [...(mountsByVolume.get(m.name) ?? []), entry]);
    }
  }
  return (
    <Box sx={{ px: 2, pt: 2 }}>
      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
        Volumes
      </Typography>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Name</TableCell>
            <TableCell>Source</TableCell>
            <TableCell>Mounted at</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {volumes.map((v) => {
            const info = volumeInfo(v);
            return (
              <TableRow key={v.name}>
                <TableCell sx={{ wordBreak: 'break-all' }}>{v.name}</TableCell>
                <TableCell>
                  {info.refKind && info.refName ? (
                    <Link component="button" variant="body2" sx={{ textAlign: 'left' }} onClick={() => onOpenRef(info.refKind!, info.refName!)}>
                      {info.type}/{info.detail}
                    </Link>
                  ) : (
                    `${info.type}${info.detail ? `/${info.detail}` : ''}`
                  )}
                </TableCell>
                <TableCell sx={{ whiteSpace: 'pre-line', wordBreak: 'break-all' }}>{(mountsByVolume.get(v.name) ?? []).join('\n')}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Box>
  );
}

function SchedulingSection({ spec }: { spec: PodSpec | undefined }) {
  const tolerations = spec?.tolerations ?? [];
  const nodeSelector = spec?.nodeSelector ?? {};
  if (!tolerations.length && !Object.keys(nodeSelector).length) return null;
  return (
    <Box sx={{ px: 2, pt: 2 }}>
      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
        Scheduling
      </Typography>
      <Stack spacing={1.5}>
        <KeyValueChips title="Node selector" entries={Object.keys(nodeSelector).length ? nodeSelector : undefined} />
        {tolerations.length > 0 && (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Toleration key</TableCell>
                <TableCell>Operator</TableCell>
                <TableCell>Value</TableCell>
                <TableCell>Effect</TableCell>
                <TableCell>Seconds</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {tolerations.map((t, i) => (
                <TableRow key={i}>
                  <TableCell>{t.key ?? '(all)'}</TableCell>
                  <TableCell>{t.operator ?? 'Equal'}</TableCell>
                  <TableCell>{t.value ?? ''}</TableCell>
                  <TableCell>{t.effect ?? '(all)'}</TableCell>
                  <TableCell>{t.tolerationSeconds ?? ''}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Stack>
    </Box>
  );
}
