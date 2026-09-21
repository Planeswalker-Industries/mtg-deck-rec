"use client";

import {
  BooleanInput,
  Datagrid,
  DateField,
  Edit,
  EmailField,
  FunctionField,
  List,
  NumberField,
  SearchInput,
  Show,
  SimpleForm,
  SimpleShowLayout,
  TextField,
  TextInput,
  TopToolbar,
  useRecordContext,
} from "react-admin";
import { MAX_ADMIN_NOTE_CHARS, MAX_DISPLAY_NAME_CHARS, type AdminUser } from "@/lib/admin/types";
import { Pill, Pills } from "./pill";

/**
 * User management. The list is the whole account table; the editor exposes exactly the three things an admin can
 * change — the display name, platform admin access, and whether the account is banned. Everything else about an
 * account belongs to its owner.
 */

const userFilters = [<SearchInput key="q" source="q" alwaysOn placeholder="Email, name or id" />];

const UserTitle = () => {
  const record = useRecordContext<AdminUser>();
  return <span>{record?.email ?? record?.displayName ?? "User"}</span>;
};

/**
 * One Status column rather than an Admin column and a Banned column, because both are false for almost every row and
 * two columns of crosses is 50 rows of noise to carry two facts.
 */
const StatusPills = () => {
  const record = useRecordContext<AdminUser>();
  if (!record) return null;
  return (
    <Pills emptyLabel="No flags">
      {[
        record.isAdmin && (
          <Pill key="admin" tone="primary">
            Admin
          </Pill>
        ),
        record.banned && (
          <Pill key="banned" tone="cut">
            Banned
          </Pill>
        ),
      ]}
    </Pills>
  );
};

/** Counts line up when their figures are the same width, so a column of them can be read down rather than across. */
const tabular = { sx: { fontVariantNumeric: "tabular-nums" } } as const;

export const UserList = () => (
  <List filters={userFilters} sort={{ field: "createdAt", order: "DESC" }} perPage={25} actions={<TopToolbar />} empty={false}>
    <Datagrid rowClick="show" bulkActionButtons={false}>
      {/* Plain text, not an EmailField: the whole row opens the record, and a mailto link inside it is a second
          target competing for the same click. The address is a mail link on the Show screen, where it is a choice. */}
      <TextField source="email" label="Email" />
      <TextField source="displayName" label="Display name" emptyText="—" />
      <FunctionField label="Status" render={() => <StatusPills />} sortable={false} />
      <NumberField source="deckCount" label="Decks" {...tabular} />
      <NumberField source="collectionCount" label="Collection" {...tabular} />
      <DateField source="lastSignInAt" label="Last sign-in" showTime emptyText="never" />
      <DateField source="createdAt" label="Joined" />
    </Datagrid>
  </List>
);

/** The admins-only view of the same list, so "who can reach this area" is one click rather than a filter to remember. */
export const PlatformAdminList = () => (
  <List
    resource="platform-admins"
    filters={userFilters}
    sort={{ field: "adminSince", order: "DESC" }}
    perPage={25}
    actions={<TopToolbar />}
    empty={false}
  >
    <Datagrid rowClick={(id) => `/users/${id}/show`} bulkActionButtons={false}>
      <TextField source="email" label="Email" />
      <TextField source="displayName" label="Display name" emptyText="—" />
      <TextField source="adminNote" label="Why" emptyText="—" />
      <DateField source="adminSince" label="Admin since" showTime />
      <DateField source="lastSignInAt" label="Last sign-in" showTime emptyText="never" />
    </Datagrid>
  </List>
);

export const UserShow = () => (
  <Show title={<UserTitle />}>
    <SimpleShowLayout>
      <EmailField source="email" label="Email" />
      <TextField source="displayName" label="Display name" emptyText="—" />
      <FunctionField label="Status" render={() => <StatusPills />} />
      <TextField source="adminNote" label="Why they have it" emptyText="—" />
      <DateField source="adminSince" label="Admin since" showTime emptyText="—" />
      <DateField source="emailConfirmedAt" label="Email confirmed" showTime emptyText="not confirmed" />
      <DateField source="lastSignInAt" label="Last sign-in" showTime emptyText="never" />
      <DateField source="createdAt" label="Joined" showTime />
      <NumberField source="deckCount" label="Saved decks" {...tabular} />
      <NumberField source="collectionCount" label="Collection entries" {...tabular} />
      <TextField source="id" label="User id" />
    </SimpleShowLayout>
  </Show>
);

export const UserEdit = () => (
  <Edit title={<UserTitle />} mutationMode="pessimistic" redirect="show">
    <SimpleForm sx={{ gap: 1.5, maxWidth: "48rem" }}>
      <TextInput
        source="displayName"
        label="Display name"
        helperText="Shown on this person's public deck pages. Clearing it removes the name, not the account."
        slotProps={{ htmlInput: { maxLength: MAX_DISPLAY_NAME_CHARS } }}
        fullWidth
      />
      <BooleanInput
        source="isAdmin"
        label="Platform admin"
        helperText="Full access to this area. You cannot remove your own, and the last admin cannot be removed at all."
      />
      <TextInput
        source="adminNote"
        label="Why they have it"
        helperText="Recorded beside the grant so the admin list is still readable a year from now."
        slotProps={{ htmlInput: { maxLength: MAX_ADMIN_NOTE_CHARS } }}
        fullWidth
      />
      <BooleanInput
        source="banned"
        label="Banned"
        helperText="Blocks sign-in and is reversible. Their decks and collection stay. Remove platform admin access first."
      />
    </SimpleForm>
  </Edit>
);
