"use client";

import { Box, Card, CardContent, Typography } from "@mui/material";
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
import { Ban, CircleCheck, CircleX, TriangleAlert, type LucideIcon } from "lucide-react";
import { ADMIN_SYNC_JOBS, ADMIN_SYNC_STATUSES, type AdminSyncJob, type AdminSyncRun, type AdminSyncStatus } from "@/lib/admin/types";
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
  edhrec_stats: "EDHREC import (retired)",
  spellbook_combos: "Spellbook combos",
  corpus_collate: "Corpus collation",
  edhrec_pages: "EDHREC pages",
  precompute_commanders: "Commander stats",
  precompute_baseline: "Nightly baseline",
  precompute_scores: "Commander scores",
  precompute_substitutes: "Card substitutes",
  precompute_roles: "Card roles",
  precompute_combos: "Combo pieces",
  precompute_pairs: "Card pairs",
  precompute_global_pairs: "Card pairs (all decks)",
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
  running: "ink",
  succeeded: "add",
  skipped_unchanged: "muted",
  failed: "cut",
  failed_sanity: "cut",
  abandoned: "replace",
};

/** Every status colour comes with an icon; ink ("running") and muted ("unchanged") are not status colours. */
const STATUS_ICON: Partial<Record<AdminSyncStatus, LucideIcon>> = {
  succeeded: CircleCheck,
  failed: CircleX,
  failed_sanity: CircleX,
  abandoned: Ban,
};

/** The worker heartbeats every few minutes while a job runs; half an hour without one means its process is gone. */
const STUCK_AFTER_MS = 30 * 60 * 1000;

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

/** A run that still says running but has stopped heartbeating: its worker died without closing it. */
const isStuck = (run: AdminSyncRun) => run.status === "running" && Date.now() - Date.parse(run.heartbeatAt) > STUCK_AFTER_MS;

function RunStatusPill({ run }: { run: AdminSyncRun }) {
  if (isStuck(run)) {
    return (
      <Pill tone="cut">
        <TriangleAlert aria-hidden size={12} />
        Stuck
      </Pill>
    );
  }
  const Icon = STATUS_ICON[run.status];
  return (
    <Pill tone={STATUS_TONE[run.status]}>
      {Icon && <Icon aria-hidden size={12} />}
      {STATUS_LABEL[run.status]}
    </Pill>
  );
}

const StatusPill = () => {
  const run = useRecordContext<AdminSyncRun>();
  return run ? <RunStatusPill run={run} /> : null;
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
  // Its three parts are cells of the grid in LatestRuns, so every job's pill and date line up with the others'.
  return (
    <Box sx={{ display: "contents" }}>
      <Link to={`/sync-runs/${run.id}/show`} sx={{ fontWeight: 600, alignSelf: "center", minWidth: 0 }}>
        {JOB_LABEL[job]}
      </Link>
      <Box sx={{ alignSelf: "center", justifySelf: "start" }}>
        <RunStatusPill run={run} />
      </Box>
      <Typography variant="body2" component="span" sx={{ color: ADMIN_TOKENS.mutedForeground, alignSelf: "center", whiteSpace: "nowrap" }}>
        {new Date(run.startedAt).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}
      </Typography>
    </Box>
  );
}

/** Each job's newest run, a line per job: on the Sync runs screen and on the admin home's Worker section. */
export function LatestRuns() {
  return (
    // Job, status and date as columns, twice across on a wide screen; the date column takes what is left.
    <Box
      sx={{
        display: "grid",
        columnGap: 1.5,
        rowGap: 1,
        gridTemplateColumns: { xs: "auto auto 1fr", md: "auto auto 1fr auto auto 1fr" },
      }}
    >
      {ADMIN_SYNC_JOBS.map((job) => (
        <LatestRun key={job} job={job} />
      ))}
    </Box>
  );
}

/** At a glance: how each job's last run went, above the full history. */
function LatestRunsCard() {
  return (
    <Card sx={{ mt: 2 }}>
      <CardContent>
        <Typography variant="h6" component="h2" sx={{ mb: 1.5 }}>
          Latest run of each job
        </Typography>
        <LatestRuns />
      </CardContent>
    </Card>
  );
}

export const SyncRunList = () => (
  <>
    <LatestRunsCard />
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
