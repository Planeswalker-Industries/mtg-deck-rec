"use client";

import { Box, Stack } from "@mui/material";
import { alpha } from "@mui/material/styles";
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
import { ADMIN_TOKENS } from "./theme";

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
 * Status as pills, in the site's own shape: a rounded outline that is quiet until it has something to say.
 *
 * One column rather than an Admin column and a Banned column, because both are false for almost every row and two
 * columns of crosses is 50 rows of noise to carry two facts. The pill is only drawn when it is true, and it says
 * what it means in words — colour alone would not.
 */
const STATUS_PILL = {
  display: "inline-flex",
  alignItems: "center",
  borderRadius: 999,
  border: "1px solid",
  px: 1,
  py: 0.25,
  fontSize: "0.6875rem",
  fontWeight: 700,
  lineHeight: 1.4,
  whiteSpace: "nowrap",
} as const;

const StatusPills = () => {
  const record = useRecordContext<AdminUser>();
  if (!record) return null;
  if (!record.isAdmin && !record.banned) {
    return (
      <Box component="span" sx={{ color: ADMIN_TOKENS.mutedForeground }} aria-label="No flags">
        —
      </Box>
    );
  }
  return (
    <Stack direction="row" spacing={0.5} component="span">
      {record.isAdmin && (
        <Box
          component="span"
          sx={{ ...STATUS_PILL, color: ADMIN_TOKENS.primary, borderColor: alpha(ADMIN_TOKENS.primary, 0.45), backgroundColor: alpha(ADMIN_TOKENS.primary, 0.1) }}
        >
          Admin
        </Box>
      )}
      {record.banned && (
        <Box
          component="span"
          sx={{ ...STATUS_PILL, color: ADMIN_TOKENS.cut, borderColor: alpha(ADMIN_TOKENS.cut, 0.45), backgroundColor: alpha(ADMIN_TOKENS.cut, 0.1) }}
        >
          Banned
        </Box>
      )}
    </Stack>
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
