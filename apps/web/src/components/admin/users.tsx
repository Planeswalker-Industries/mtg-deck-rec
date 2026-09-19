"use client";

import {
  BooleanField,
  BooleanInput,
  Datagrid,
  DateField,
  Edit,
  EmailField,
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

/**
 * User management. The list is the whole account table; the editor exposes exactly the three things an admin can
 * change — the display name, platform admin access, and whether the account is banned. Everything else about an
 * account belongs to its owner.
 */

const userFilters = [<SearchInput key="q" source="q" alwaysOn placeholder="Email, name or id" />];

/** Delete is the destructive one, so it is never undoable: the account and its decks go at once. */
const UserTitle = () => {
  const record = useRecordContext<AdminUser>();
  return <span>{record?.email ?? record?.displayName ?? "User"}</span>;
};

export const UserList = () => (
  <List
    filters={userFilters}
    sort={{ field: "createdAt", order: "DESC" }}
    perPage={25}
    actions={<TopToolbar />}
    empty={false}
  >
    <Datagrid rowClick="show" bulkActionButtons={false}>
      <EmailField source="email" label="Email" />
      <TextField source="displayName" label="Display name" />
      <BooleanField source="isAdmin" label="Admin" />
      <BooleanField source="banned" label="Banned" />
      <NumberField source="deckCount" label="Decks" />
      <NumberField source="collectionCount" label="Collection" />
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
      <EmailField source="email" label="Email" />
      <TextField source="displayName" label="Display name" />
      <TextField source="adminNote" label="Why" emptyText="—" />
      <DateField source="adminSince" label="Admin since" showTime />
      <DateField source="lastSignInAt" label="Last sign-in" showTime emptyText="never" />
    </Datagrid>
  </List>
);

export const UserShow = () => (
  <Show title={<UserTitle />}>
    <SimpleShowLayout>
      <TextField source="id" label="User id" />
      <EmailField source="email" label="Email" />
      <TextField source="displayName" label="Display name" emptyText="—" />
      <BooleanField source="isAdmin" label="Platform admin" />
      <TextField source="adminNote" label="Why they have it" emptyText="—" />
      <DateField source="adminSince" label="Admin since" showTime emptyText="—" />
      <BooleanField source="banned" label="Banned" />
      <DateField source="emailConfirmedAt" label="Email confirmed" showTime emptyText="not confirmed" />
      <DateField source="lastSignInAt" label="Last sign-in" showTime emptyText="never" />
      <DateField source="createdAt" label="Joined" showTime />
      <NumberField source="deckCount" label="Saved decks" />
      <NumberField source="collectionCount" label="Collection entries" />
    </SimpleShowLayout>
  </Show>
);

export const UserEdit = () => (
  <Edit title={<UserTitle />} mutationMode="pessimistic" redirect="show">
    <SimpleForm>
      <TextField source="email" label="Email" />
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
