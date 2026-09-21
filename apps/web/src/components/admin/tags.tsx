"use client";

import { Typography } from "@mui/material";
import {
  BooleanInput,
  Datagrid,
  DateField,
  Edit,
  FormDataConsumer,
  FunctionField,
  Labeled,
  List,
  NumberField,
  SearchInput,
  SimpleForm,
  TextField,
  TextInput,
  TopToolbar,
  useRecordContext,
} from "react-admin";
import { MAX_TAG_REASON_CHARS, type AdminTag } from "@/lib/admin/types";
import { Pill, Pills } from "./pill";
import { ADMIN_TOKENS } from "./theme";

/**
 * The tag kill switch. Tagger tags drive "does the same job", and some of them are trivia or plain wrong; switching
 * one off takes it out of recommendations without waiting for Tagger to change. The switch is keyed by the tag's
 * uuid, so a tag sync never undoes it.
 */

const tagFilters = [
  <SearchInput key="q" source="q" alwaysOn placeholder="Tag name, slug or id" />,
  <BooleanInput key="disabledOnly" source="disabledOnly" label="Switched off only" alwaysOn />,
  <BooleanInput key="functionalOnly" source="functionalOnly" label="Used by recommendations only" alwaysOn />,
];

/** idf is 0..1 and only its first two places mean anything to a person reading the list. */
const IDF_FORMAT = { minimumFractionDigits: 2, maximumFractionDigits: 2 } as const;

/** Counts line up when their figures are the same width, so a column of them can be read down rather than across. */
const tabular = { sx: { fontVariantNumeric: "tabular-nums" } } as const;

const TagTitle = () => {
  const record = useRecordContext<AdminTag>();
  return <span>{record?.label ?? "Tag"}</span>;
};

const TagPills = () => {
  const record = useRecordContext<AdminTag>();
  if (!record) return null;
  return (
    <Pills emptyLabel="Not used by recommendations">
      {[
        record.disabled && (
          <Pill key="off" tone="cut">
            Switched off
          </Pill>
        ),
        record.isFunctional && (
          <Pill key="functional" tone="add">
            Recommendations
          </Pill>
        ),
      ]}
    </Pills>
  );
};

export const TagList = () => (
  <List filters={tagFilters} sort={{ field: "cardCount", order: "DESC" }} perPage={25} actions={<TopToolbar />} empty={false}>
    <Datagrid rowClick="edit" bulkActionButtons={false}>
      <TextField source="label" label="Tag" />
      <TextField source="slug" label="Slug" />
      <FunctionField label="Status" render={() => <TagPills />} sortable={false} />
      <NumberField source="cardCount" label="Cards" {...tabular} />
      <NumberField source="idf" label="Specificity" options={IDF_FORMAT} {...tabular} />
      <DateField source="disabledAt" label="Switched off" showTime emptyText="—" />
    </Datagrid>
  </List>
);

/** Who threw the switch and when, or nothing for a tag that is on. */
const SwitchedOffBy = () => {
  const record = useRecordContext<AdminTag>();
  if (!record?.disabled) return null;
  const when = record.disabledAt ? new Date(record.disabledAt).toLocaleString() : "an unknown time";
  return (
    <Typography variant="body2" sx={{ color: ADMIN_TOKENS.mutedForeground }}>
      Switched off by {record.disabledByEmail ?? "an account that no longer exists"} on {when}.
    </Typography>
  );
};

/** What switching this tag changes, in words, so the effect isn't guessed from the tag's name. */
const EffectNote = () => {
  const record = useRecordContext<AdminTag>();
  if (!record) return null;
  return (
    <Typography variant="body2" sx={{ color: ADMIN_TOKENS.mutedForeground, maxWidth: "48rem" }}>
      {record.isFunctional
        ? "Recommendations and the tag lists on card and deck pages use this tag. Switched off, new recommendations stop using it straight away, and cached pages catch up on their next visit."
        : "Nothing on the site uses this tag today: recommendations and tag lists only read the functional tags. Switching it off keeps it out if it ever becomes one."}
    </Typography>
  );
};

export const TagEdit = () => (
  <Edit title={<TagTitle />} mutationMode="pessimistic" redirect="list">
    <SimpleForm sx={{ gap: 1.5, maxWidth: "48rem" }}>
      <Labeled label="Tag">
        <TextField source="label" />
      </Labeled>
      <Labeled label="Slug">
        <TextField source="slug" />
      </Labeled>
      <Labeled label="Description">
        <TextField source="description" emptyText="—" />
      </Labeled>
      <Labeled label="Cards tagged">
        <NumberField source="cardCount" {...tabular} />
      </Labeled>
      <EffectNote />
      <BooleanInput source="disabled" label="Switched off" helperText="Kept through every Tagger sync until someone switches it back on." />
      <FormDataConsumer<AdminTag>>
        {({ formData }) =>
          formData.disabled ? (
            <TextInput
              source="disabledReason"
              label="Why"
              helperText="Recorded beside the switch so the list still makes sense a year from now."
              slotProps={{ htmlInput: { maxLength: MAX_TAG_REASON_CHARS } }}
              fullWidth
            />
          ) : null
        }
      </FormDataConsumer>
      <SwitchedOffBy />
    </SimpleForm>
  </Edit>
);
