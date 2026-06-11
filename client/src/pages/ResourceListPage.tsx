import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, Dialog, DialogContent, DialogTitle, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import SubjectIcon from '@mui/icons-material/Subject';
import HubOutlinedIcon from '@mui/icons-material/HubOutlined';
import { useParams, useSearchParams } from 'react-router';
import { columnsForKind, groupFromPath, type ResourceKindInfo } from '@kubedeck/shared';
import { useApiResourcesForContexts, useCreateResource, useFilteredList, useResourceMetrics, type ClusterRow } from '../api/queries.js';
import { useClustersStore } from '../state/clusters.js';
import { useDockStore, dockTabId } from '../state/dock.js';
import { ResourceTable } from '../components/ResourceTable.js';
import { buildColumns, makeMetricsLookup } from '../components/columns.js';
import type { ResourceSelection } from '../components/ResourceDetailDrawer.js';
import { useDetailStore } from '../state/detail.js';
import { RowActions } from '../components/RowActions.js';
import { YamlEditor } from '../components/YamlEditor.js';
import { EmptyState } from '../components/EmptyState.js';

export function ResourceListPage() {
  const params = useParams<{ group: string; version: string; plural: string }>();
  const group = groupFromPath(params.group ?? 'core');
  const version = params.version ?? 'v1';
  const plural = params.plural ?? 'pods';

  const selected = useClustersStore((s) => s.selected);
  const { data: apiResources } = useApiResourcesForContexts(selected);
  const kindInfo: ResourceKindInfo | undefined = useMemo(
    () => apiResources?.resources.find((r) => r.group === group && r.version === version && r.plural === plural),
    [apiResources, group, version, plural],
  );
  const kind = kindInfo?.kind ?? plural;
  const namespaced = kindInfo?.namespaced ?? true;

  const list = useFilteredList(group, version, plural, namespaced);
  const isPodOrNode = kind === 'Pod' || kind === 'Node';
  const { data: podMetrics } = useResourceMetrics(isPodOrNode ? selected : [], kind === 'Node' ? 'nodes' : 'pods');
  const metricsUnavailable = isPodOrNode ? selected.filter((ctx) => podMetrics?.get(ctx)?.available === false) : [];

  const [searchParams, setSearchParams] = useSearchParams();
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedRows, setSelectedRows] = useState<ClusterRow[]>([]);
  const addTab = useDockStore((s) => s.addTab);
  const create = useCreateResource();

  // Detail selection deep-linked via ?sel=ctx|namespace|name
  const sel: ResourceSelection | undefined = useMemo(() => {
    const raw = searchParams.get('sel');
    if (!raw) return undefined;
    const [ctx, namespace, name] = raw.split('|');
    if (!ctx || !name) return undefined;
    return { ctx, group, version, plural, kind, name, namespace: namespace || undefined };
  }, [searchParams, group, version, plural, kind]);

  // Mirror the URL selection into the global detail drawer; close on unmount.
  const openDetail = useDetailStore((s) => s.open);
  const closeDetail = useDetailStore((s) => s.close);
  const detailOpen = useDetailStore((s) => s.stack.length > 0);
  useEffect(() => {
    if (sel) openDetail(sel);
    else closeDetail();
  }, [sel, openDetail, closeDetail]);
  useEffect(() => () => closeDetail(), [closeDetail]);
  // Drawer closed via its X → drop the ?sel deep link. The ref guards
  // against clearing on mount, before the mirror effect has opened it.
  const wasDetailOpen = useRef(false);
  useEffect(() => {
    if (wasDetailOpen.current && !detailOpen && searchParams.get('sel')) setSearchParams({});
    wasDetailOpen.current = detailOpen;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailOpen]);

  const columns = useMemo(() => {
    const ids = columnsForKind(kind, namespaced);
    const cols = buildColumns(ids, { multiCluster: selected.length > 1, metrics: makeMetricsLookup(kind, podMetrics) });
    cols.push({
      field: '_actions',
      headerName: '',
      width: 50,
      sortable: false,
      filterable: false,
      renderCell: (p) => <RowActions target={{ ctx: p.row.ctx, group, version, plural, kind, obj: p.row.obj }} />,
    });
    return cols;
  }, [kind, namespaced, selected.length, podMetrics, group, version, plural]);

  const supportsGvr = (r: ResourceKindInfo) => r.group === group && r.version === version && r.plural === plural;
  const discoveryMissing = useMemo(() => {
    if (!apiResources) return [];
    return selected.filter((ctx) => {
      if (apiResources.errors[ctx]) return false;
      return !(apiResources.byContext[ctx] ?? []).some(supportsGvr);
    });
  }, [apiResources, selected, group, version, plural]);
  const unavailable = Object.entries(list.status).filter(([, s]) => s.state === 'unavailable');
  const unavailableContexts = new Set(unavailable.map(([ctx]) => ctx));
  const discoveryOnlyMissing = discoveryMissing.filter((ctx) => !unavailableContexts.has(ctx));
  const errors = Object.entries(list.status).filter(([, s]) => s.state === 'error');

  if (selected.length === 0) {
    return (
      <EmptyState
        icon={<HubOutlinedIcon />}
        title="No cluster selected"
        subtitle="Pick one or more clusters from the switcher in the top bar."
      />
    );
  }

  const multiLogs = kind === 'Pod' && selectedRows.length > 0;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <Box sx={{ px: 1.5, pt: 1.5 }}>
        <Typography variant="h6">{kind === 'Endpoints' ? kind : `${kind}s`}</Typography>
        {errors.map(([ctx, s]) => (
          <Alert key={ctx} severity="error" sx={{ mt: 0.5 }}>
            {ctx}: {s.message ?? 'watch error'}
          </Alert>
        ))}
        {unavailable.map(([ctx, s]) => (
          <Alert key={ctx} severity="info" sx={{ mt: 0.5 }}>
            {ctx}: {s.message ?? `${kind} is not installed on this cluster.`}
          </Alert>
        ))}
        {discoveryOnlyMissing.length > 0 && (
          <Alert severity="info" sx={{ mt: 0.5 }}>
            {kind} is not installed in {discoveryOnlyMissing.join(', ')}.
          </Alert>
        )}
        {metricsUnavailable.length > 0 && (
          <Alert severity="info" sx={{ mt: 0.5 }}>
            CPU/Memory unavailable — metrics-server is not reachable in {metricsUnavailable.join(', ')}.
          </Alert>
        )}
      </Box>
      <ResourceTable
        rows={list.rows}
        columns={columns}
        loading={Object.values(list.status).some((s) => s.state === 'loading')}
        onRowClick={(row) => setSearchParams({ sel: `${row.ctx}|${row.obj.metadata.namespace ?? ''}|${row.obj.metadata.name}` })}
        checkboxSelection={kind === 'Pod'}
        onSelectionChange={kind === 'Pod' ? setSelectedRows : undefined}
        toolbar={
          <>
            {multiLogs && (
              <Button
                startIcon={<SubjectIcon />}
                variant="outlined"
                onClick={() => {
                  // Group by ctx+namespace — one log session per group.
                  const groups = new Map<string, ClusterRow[]>();
                  for (const row of selectedRows) {
                    const key = `${row.ctx}|${row.obj.metadata.namespace ?? ''}`;
                    groups.set(key, [...(groups.get(key) ?? []), row]);
                  }
                  for (const [key, rows] of groups) {
                    const [ctx, namespace] = key.split('|');
                    addTab({
                      kind: 'logs',
                      id: dockTabId(),
                      title: `logs: ${rows.length} pods`,
                      ctx: ctx!,
                      namespace: namespace ?? '',
                      pods: rows.map((r) => r.obj.metadata.name),
                      follow: true,
                      tailLines: 500,
                    });
                  }
                }}
              >
                Logs ({selectedRows.length})
              </Button>
            )}
            <Button startIcon={<AddIcon />} variant="outlined" onClick={() => setCreateOpen(true)}>
              Create
            </Button>
          </>
        }
      />
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="md" fullWidth slotProps={{ paper: { sx: { height: '80vh' } } }}>
        <DialogTitle>Create resource{selected.length > 1 ? ` on ${selected[0]}` : ''}</DialogTitle>
        <DialogContent sx={{ p: 0, display: 'flex', flexDirection: 'column' }}>
          <YamlEditor
            value={createTemplate(kind, group, version)}
            applyLabel="Create"
            onApply={async (text) => {
              await create.mutateAsync({ ctx: selected[0]!, yamlBody: text });
              setCreateOpen(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </Box>
  );
}

function createTemplate(kind: string, group: string, version: string): string {
  const apiVersion = group ? `${group}/${version}` : version;
  return `apiVersion: ${apiVersion}\nkind: ${kind}\nmetadata:\n  name: my-${kind.toLowerCase()}\n  namespace: default\nspec: {}\n`;
}
