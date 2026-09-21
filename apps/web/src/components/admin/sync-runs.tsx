"use client";

import { Box, Card, CardContent, Stack, Typography } from "@mui/material";
import {
  Datagrid,
  DateField,
  FunctionField,
  Labeled,
  List,
  Link,
  NumberField,
  SelectInput,
  Show,
  SimpleShowLayout,
  TextField,
  TopToolbar,
  useGetList,
  useRecordContext,
} from "react-admin";
import {
  ADMIN_SYNC_JOBS,
  ADMIN_SYNC_STATUSES,
  type AdminSyncJob,
  type AdminSyncRun,
  type AdminSyncStatus,
} from "@/lib/admin/types";
import { Pill, type PillTone } from "./pill";
import { ADMIN_TOKENS } from "./theme";

/**
 * What the worker did and when: every Scryfall, Tagger and corpus run, newest first, with its row counts, the metrics
 * the next run's sanity gate compares against, and the error when it failed. Read-only — runs are the worker's
 * own record.
 */

const JOB_LABEL: Record<AdminSyncJob, string> = {
  scryfall_catalog: "Scryfall catalog",
  scryfall_printings: "Scryfall printings",
  oracle_tags: "Tagger tags",
  corpus_aggregate: "Deck corpus",
  archidekt_crawl: "Archidekt crawl",
  precon_import: "Precon import",
  vote_aggregate: "Vote aggregate",
};

const STATUS_LABEL: Record<AdminSyncStatus, string> = {
  running: "Running",
  succeeded: "Succeeded",
  skipped_unchanged: "Unchanged",
  failed: "Failed",
  failed_sanity: "Failed sanity check",
  abandoned: "Abandoned",
};

/** Trouble is rose, health is jade, a run cut short is violet ("look closer"), and "nothing to do" stays quiet. */
const STATUS_TONE: Record<AdminSyncStatus, PillTone> = {
  running: "primary",
  succeeded: "add",
  skipped_unchanged: "muted",
  failed: "cut",
  failed_sanity: "cut",
  abandoned: "replace",
};

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;

/** "42 s", "3 min 5 s", "1 h 12 min": a run's length at the precision a person reads it. */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / MS_PER_SECOND));
  if (seconds < SECONDS_PER_MINUTE) return `${seconds} s`;
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
  if (minutes < MINUTES_PER_HOUR) return `${minutes} min ${seconds % SECONDS_PER_MINUTE} s`;
  return `${Math.floor(minutes / MINUTES_PER_HOUR)} h ${minutes % MINUTES_PER_HOUR} min`;
}

const runDuration = (run: AdminSyncRun) =>
  run.finishedAt ? formatDuration(Date.parse(run.finishedAt) - Date.parse(run.startedAt)) : "still running";

const syncRunFilters = [
  <SelectInput
    key="job"
    source="job"
    label="Job"
    choices={ADMIN_SYNC_JOBS.map((id) => ({ id, name: JOB_LABEL[id] }))}
    emptyText="Every job"
    alwaysOn
  />,
  <SelectInput
    key="status"
    source="status"
    label="Status"
    choices={ADMIN_SYNC_STATUSES.map((id) => ({ id, name: STATUS_LABEL[id] }))}
    emptyText="Every status"
    alwaysOn
  />,
];

/** Counts line up when their figures are the same width, so a column of them can be read down rather than across. */
const tabular = { sx: { fontVariantNumeric: "tabular-nums" } } as const;

const StatusPill = () => {
  const run = useRecordContext<AdminSyncRun>();
  return run ? <Pill tone={STATUS_TONE[run.status]}>{STATUS_LABEL[run.status]}</Pill> : null;
};

/** How far an error is shown in the list before it's cut off; the whole message is on the run's page. */
const ERROR_PREVIEW_CHARS = 80;

const ErrorPreview = () => {
  const run = useRecordContext<AdminSyncRun>();
  if (!run?.error) return <>—</>;
  return <>{run.error.length > ERROR_PREVIEW_CHARS ? `${run.error.slice(0, ERROR_PREVIEW_CHARS)}…` : run.error}</>;
};

/** The newest run of one job, or nothing when the job has never run. One small request per job. */
function LatestRun({ job }: { job: AdminSyncJob }) {
  const { data, isPending } = useGetList<AdminSyncRun>("sync-runs", {
    pagination: { page: 1, perPage: 1 },
    sort: { field: "startedAt", order: "DESC" },
    filter: { job },
  });
  const run = data?.[0];
  if (isPending || !run) return null;
  return (
    <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 0.5, minWidth: 0 }}>
      <Link to={`/sync-runs/${run.id}/show`} sx={{ fontWeight: 700, whiteSpace: "nowrap" }}>
        {JOB_LABEL[job]}
      </Link>
      <Pill tone={STATUS_TONE[run.status]}>{STATUS_LABEL[run.status]}</Pill>
      <Typography variant="body2" component="span" sx={{ color: ADMIN_TOKENS.mutedForeground, whiteSpace: "nowrap" }}>
        {new Date(run.startedAt).toLocaleString()}
      </Typography>
    </Stack>
  );
}

/** At a glance: how each job's last run went, above the full history. */
function LatestRuns() {
  return (
    <Card sx={{ mt: 2 }}>
      <CardContent>
        <Typography variant="h6" component="h2" sx={{ mb: 1.5 }}>
          Latest run of each job
        </Typography>
        <Box sx={{ display: "grid", gap: 1, gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" } }}>
          {ADMIN_SYNC_JOBS.map((job) => (
            <LatestRun key={job} job={job} />
          ))}
        </Box>
      </CardContent>
    </Card>
  );
}

export const SyncRunList = () => (
  <>
    <LatestRuns />
    <List
      filters={syncRunFilters}
      sort={{ field: "startedAt", order: "DESC" }}
      perPage={25}
      actions={<TopToolbar />}
      empty={false}
      title="Sync runs"
    >
      <Datagrid rowClick="show" bulkActionButtons={false}>
        <FunctionField label="Job" render={(run: AdminSyncRun) => JOB_LABEL[run.job]} sortable={false} />
        <FunctionField label="Status" render={() => <StatusPill />} sortable={false} />
        <DateField source="startedAt" label="Started" showTime />
        <FunctionField label="Took" render={runDuration} sortable={false} />
        <NumberField source="rowsRead" label="Read" sortable={false} {...tabular} />
        <NumberField source="rowsChanged" label="Changed" sortable={false} {...tabular} />
        <FunctionField label="Error" render={() => <ErrorPreview />} sortable={false} />
      </Datagrid>
    </List>
  </>
);

const SyncRunTitle = () => {
  const run = useRecordContext<AdminSyncRun>();
  return <span>{run ? `${JOB_LABEL[run.job]} run ${run.id}` : "Sync run"}</span>;
};

/** Metrics as indented JSON: their shape differs per job, and they are read to compare against the next run. */
const Metrics = () => {
  const run = useRecordContext<AdminSyncRun>();
  if (!run?.metrics) return <>—</>;
  return (
    <Box
      component="pre"
      sx={{ m: 0, p: 1.5, borderRadius: 1, border: `1px solid ${ADMIN_TOKENS.seam}`, overflowX: "auto", fontSize: "0.8125rem" }}
    >
      {JSON.stringify(run.metrics, null, 2)}
    </Box>
  );
};

const FullError = () => {
  const run = useRecordContext<AdminSyncRun>();
  if (!run?.error) return <>—</>;
  return (
    <Box component="pre" sx={{ m: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", color: ADMIN_TOKENS.cut, fontSize: "0.8125rem" }}>
      {run.error}
    </Box>
  );
};

export const SyncRunShow = () => (
  <Show title={<SyncRunTitle />}>
    <SimpleShowLayout>
      <FunctionField label="Job" render={(run: AdminSyncRun) => JOB_LABEL[run.job]} />
      <FunctionField label="Status" render={() => <StatusPill />} />
      <DateField source="startedAt" label="Started" showTime />
      <DateField source="finishedAt" label="Finished" showTime emptyText="not yet" />
      <FunctionField label="Took" render={runDuration} />
      <DateField source="heartbeatAt" label="Last heartbeat" showTime />
      <NumberField source="rowsRead" label="Rows read" {...tabular} />
      <NumberField source="rowsChanged" label="Rows changed" {...tabular} />
      <Labeled label="Error">
        <FullError />
      </Labeled>
      <Labeled label="Metrics">
        <Metrics />
      </Labeled>
      <TextField source="sourceUri" label="Source" emptyText="—" />
      <DateField source="sourceUpdatedAt" label="Source updated" showTime emptyText="—" />
      <TextField source="workerId" label="Worker" />
      <TextField source="id" label="Run id" />
    </SimpleShowLayout>
  </Show>
);
