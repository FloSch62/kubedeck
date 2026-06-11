/** REST API data transfer objects shared between server and client. */

export type ContextHealth = 'connected' | 'connecting' | 'error' | 'unknown';

export interface ContextInfo {
  name: string;
  cluster: string;
  user: string;
  namespace?: string;
  server?: string;
  health: ContextHealth;
  healthMessage?: string;
  /** Whether the server currently holds an active handle (watchers, pollers). */
  active: boolean;
  kubernetesVersion?: string;
}

export interface ResourceKindInfo {
  group: string; // '' for core
  version: string;
  kind: string;
  plural: string;
  namespaced: boolean;
  verbs: string[];
  shortNames?: string[];
  categories?: string[];
  /** True if this kind comes from a CRD rather than a builtin API group. */
  custom?: boolean;
}

export interface KubeObjectMeta {
  name: string;
  namespace?: string;
  uid: string;
  resourceVersion?: string;
  creationTimestamp?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  ownerReferences?: Array<{
    apiVersion: string;
    kind: string;
    name: string;
    uid: string;
    controller?: boolean;
  }>;
  deletionTimestamp?: string;
}

/** Loosely-typed Kubernetes object — the UI reads what it needs per kind. */
export interface KubeObject {
  apiVersion?: string;
  kind?: string;
  metadata: KubeObjectMeta;
  spec?: Record<string, unknown>;
  status?: Record<string, unknown>;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ListResponse {
  items: KubeObject[];
  resourceVersion?: string;
  continue?: string;
}

export interface ApiErrorBody {
  message: string;
  reason?: string;
  code?: number;
  k8sStatus?: unknown;
}

// ---- Actions ----

export interface ScaleRequest {
  group: string;
  version: string;
  plural: string;
  namespace: string;
  name: string;
  replicas: number;
}

export interface RolloutRestartRequest {
  kind: 'Deployment' | 'StatefulSet' | 'DaemonSet' | 'ReplicaSet';
  namespace: string;
  name: string;
}

export interface SuspendCronJobRequest {
  namespace: string;
  name: string;
  suspend: boolean;
}

export interface SetImageRequest {
  kind: 'Deployment' | 'StatefulSet' | 'DaemonSet';
  namespace: string;
  name: string;
  container: string;
  image: string;
  initContainer?: boolean;
}

export interface CordonRequest {
  node: string;
  unschedulable: boolean;
}

export interface DrainRequest {
  node: string;
  gracePeriodSeconds?: number;
  /** Delete pods using emptyDir data. */
  force?: boolean;
}

export interface DrainStartedResponse {
  drainId: string;
  totalPods: number;
}

export interface TriggerCronJobRequest {
  namespace: string;
  name: string;
}

// ---- Detail views ----

export interface PodEnvVar {
  name: string;
  value?: string;
  source?: {
    type: 'literal' | 'configMapKeyRef' | 'secretKeyRef' | 'fieldRef' | 'resourceFieldRef' | 'configMapRef' | 'secretRef';
    ref?: string;
    key?: string;
  };
  /** Value comes from a Secret and is hidden unless requested with reveal. */
  redacted?: boolean;
  error?: string;
}

export interface PodEnvResponse {
  containers: Array<{ name: string; init?: boolean; env: PodEnvVar[] }>;
}

export interface TlsCertInfo {
  subject: string;
  issuer: string;
  serialNumber: string;
  notBefore: string;
  notAfter: string;
  sans: string[];
  isCA: boolean;
  selfSigned: boolean;
}

export interface SecretTlsResponse {
  certificates: TlsCertInfo[];
}

// ---- Logs ----

export type LogTargetKind = 'Pod' | 'Deployment' | 'ReplicaSet' | 'StatefulSet' | 'DaemonSet' | 'Service';

export interface LogTargetPod {
  name: string;
  namespace: string;
  containers: string[];
}

export interface LogTargetPodsResponse {
  pods: LogTargetPod[];
}

// ---- Metrics ----

export interface MetricsSample {
  /** epoch millis */
  t: number;
  /** CPU in millicores */
  cpuMilli: number;
  /** memory in bytes */
  memBytes: number;
}

export interface MetricsSnapshotEntry {
  name: string;
  namespace?: string;
  cpuMilli: number;
  memBytes: number;
  /** Node only: allocatable totals for utilization %. */
  cpuCapacityMilli?: number;
  memCapacityBytes?: number;
}

export interface MetricsSnapshot {
  available: boolean;
  items: MetricsSnapshotEntry[];
}

export interface MetricsHistoryResponse {
  available: boolean;
  series: MetricsSample[];
}

// ---- Overview ----

export interface OverviewProblemPod {
  namespace: string;
  name: string;
  reason: string;
  message?: string;
  restarts: number;
}

export interface OverviewWorkloadIssue {
  kind: string;
  namespace: string;
  name: string;
  ready: number;
  desired: number;
}

export interface OverviewWarningEvent {
  namespace: string;
  reason: string;
  message: string;
  involvedKind: string;
  involvedName: string;
  count: number;
  lastTimestamp?: string;
}

export interface OverviewRestart {
  namespace: string;
  pod: string;
  container: string;
  restarts: number;
  finishedAt?: string;
  reason?: string;
}

export interface ClusterOverview {
  counts: {
    nodes: number;
    namespaces: number;
    pods: number;
    podsRunning: number;
    deployments: number;
  };
  failingPods: OverviewProblemPod[];
  unavailableWorkloads: OverviewWorkloadIssue[];
  recentRestarts: OverviewRestart[];
  warningEvents: OverviewWarningEvent[];
}

// ---- Helm ----

export interface HelmReleaseSummary {
  name: string;
  namespace: string;
  revision: number;
  status: string;
  chart: string;
  chartVersion: string;
  appVersion?: string;
  updated?: string;
}

export interface HelmReleaseDetail extends HelmReleaseSummary {
  notes?: string;
  /** User-supplied values (helm -f / --set). */
  values: Record<string, unknown>;
  /** chart defaults deep-merged with user values. */
  computedValues: Record<string, unknown>;
  manifest: string;
  firstDeployed?: string;
  description?: string;
}

export interface HelmRevision {
  revision: number;
  status: string;
  chart: string;
  chartVersion: string;
  appVersion?: string;
  updated?: string;
  description?: string;
}

// ---- Port forward ----

export interface PortForwardInfo {
  id: string;
  ctx: string;
  namespace: string;
  kind: 'pod' | 'service';
  name: string;
  /** Pod actually being forwarded to (resolved for services). */
  targetPod?: string;
  remotePort: number;
  localPort: number;
  state: 'active' | 'error';
  error?: string;
  connections: number;
}

export interface PortForwardRequest {
  namespace: string;
  kind: 'pod' | 'service';
  name: string;
  remotePort: number;
  localPort?: number;
}
