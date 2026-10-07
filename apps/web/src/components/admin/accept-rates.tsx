"use client";

import { Datagrid, FunctionField, List, NumberField, SelectInput, TopToolbar } from "react-admin";
import { ADMIN_ACCEPT_RATE_DAYS, ADMIN_REC_MODES, type AdminAcceptRate, type AdminRecMode } from "@/lib/admin/types";

/**
 * The live accept rate (T065): for each kind of suggestion list and each place in it, how often a card there was shown,
 * taken and passed on, from the deck tool's recorded events. Read-only.
 */

const MODE_LABEL: Record<AdminRecMode, string> = { add: "Cards to add", cut: "Cuts", swap: "Swaps", build: "Builds" };

const filters = [
  <SelectInput
    key="mode"
    source="mode"
    label="List"
    choices={ADMIN_REC_MODES.map((id) => ({ id, name: MODE_LABEL[id] }))}
    emptyText="Every list"
    alwaysOn
  />,
  <SelectInput
    key="days"
    source="days"
    label="Window"
    choices={ADMIN_ACCEPT_RATE_DAYS.map((id) => ({ id, name: `Last ${id} days` }))}
    alwaysOn
  />,
];

/** Counts line up when their figures are the same width, so a column of them can be read down rather than across. */
const tabular = { sx: { fontVariantNumeric: "tabular-nums" } } as const;
const PERCENT = 100;
/** Every row fits one page: a few lists, each down to `ACCEPT_RATE_MAX_POSITION` places. */
const ROWS_PER_PAGE = 100;

export const AcceptRateList = () => (
  <List
    filters={filters}
    filterDefaultValues={{ days: ADMIN_ACCEPT_RATE_DAYS[1] }}
    perPage={ROWS_PER_PAGE}
    pagination={false}
    actions={<TopToolbar />}
    empty={false}
    title="Accept rate"
  >
    <Datagrid bulkActionButtons={false} rowClick={false}>
      <FunctionField label="List" render={(r: AdminAcceptRate) => MODE_LABEL[r.mode]} sortable={false} />
      <FunctionField label="Place" render={(r: AdminAcceptRate) => r.position + 1} sortable={false} {...tabular} />
      <NumberField source="shown" label="Shown" sortable={false} {...tabular} />
      <NumberField source="accepted" label="Taken" sortable={false} {...tabular} />
      <NumberField source="declined" label="Passed on" sortable={false} {...tabular} />
      <FunctionField
        label="Accept rate"
        render={(r: AdminAcceptRate) => (r.acceptRate === null ? "—" : `${(r.acceptRate * PERCENT).toFixed(1)}%`)}
        sortable={false}
        {...tabular}
      />
    </Datagrid>
  </List>
);
