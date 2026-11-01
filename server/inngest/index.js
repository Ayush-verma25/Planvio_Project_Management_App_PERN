import { Inngest } from "inngest";
import prisma from "../config/prisma.js";

// Create a client to send and receive events
export const inngest = new Inngest({ id: "Project-management" });

/**
 * Maps Clerk user data to profile fields. Uses the primary email when found,
 * otherwise the first email; omits email if the selected value is falsy.
 * Missing names and image URLs become empty strings.
 * @param {object} data Clerk user event data.
 * @returns {object} Profile fields for persistence.
 */
const getUserData = (data) => {
  const primaryEmail = data.email_addresses?.find(
    (email) => email.id === data.primary_email_address_id,
  )?.email_address;
  const email = primaryEmail ?? data.email_addresses?.[0]?.email_address;

  return {
    ...(email ? { email } : {}),
    name: `${data.first_name || ""} ${data.last_name || ""}`.trim(),
    image: data.image_url ?? "",
  };
};

/**
 * Resolves a Clerk invitation role to ADMIN or MEMBER. The final segment of
 * role takes precedence over role_name; a missing role defaults to MEMBER.
 * @param {object} data Clerk invitation event data.
 * @returns {string} The uppercase workspace role.
 * @throws {Error} If the resolved role is unsupported.
 */
const getWorkspaceMemberRole = (data) => {
  const role = (data.role?.split(":").at(-1) ?? data.role_name ?? "MEMBER")
    .toUpperCase();

  if (role === "ADMIN" || role === "MEMBER") {
    return role;
  }

  throw new Error(`Unsupported Clerk organization role: ${role}`);
};

// Inngest Function to save user data to a database
const syncUserCreation = inngest.createFunction(
  { id: "sync-user-from-clerk", triggers: [{ event: "clerk/user.created" }] },
  /**
   * Creates or updates the user from a Clerk creation event.
   * @throws {Error} If the selected email is missing or the database operation fails.
   */
  async ({ event }) => {
    const { data } = event;
    const userData = getUserData(data);

    if (!userData.email) {
      throw new Error(`Clerk user ${data.id} does not have an email address.`);
    }

    await prisma.user.upsert({
      where: { id: data.id },
      create: { id: data.id, ...userData },
      update: userData,
    });
  },
);

// Inngest Function to delete user data from a database
const syncUserDeletion = inngest.createFunction(
  { id: "delete-user-from-clerk", triggers: [{ event: "clerk/user.deleted" }] },
  /**
   * Deletes matching users; an absent user is a no-op.
   * @throws {Error} If the database operation fails.
   */
  async ({ event }) => {
    const { data } = event;

    await prisma.user.deleteMany({
      where: {
        id: data.id,
      },
    });
  },
);

// Inngest Function to update user data in a database
const syncUserUpdation = inngest.createFunction(
  { id: "update-user-from-clerk", triggers: [{ event: "clerk/user.updated" }] },
  /**
   * Updates an existing user, leaving the email unchanged if none is selected.
   * @throws {Error} If the database operation fails, including when the user is absent.
   */
  async ({ event }) => {
    const { data } = event;

    await prisma.user.update({
      where: {
        id: data.id,
      },
      data: getUserData(data),
    });
  },
);

// Inngest Functions to save workflow data to a database
const syncWorkspaceCreation = inngest.createFunction(
  {
    id: "create-workspace-from-clerk",
    triggers: [{ event: "clerk/organization.created" }],
  },
  /**
   * Upserts the workspace and assigns its creator ADMIN membership in one transaction.
   * Existing workspace ownership is preserved.
   * @throws {Error} If a database operation fails.
   */
  async ({ event }) => {
    const { data } = event;
    await prisma.$transaction(async (transaction) => {
      await transaction.workspace.upsert({
        where: { id: data.id },
        create: {
          id: data.id,
          name: data.name,
          slug: data.slug,
          ownerId: data.created_by,
          image_url: data.image_url ?? "",
        },
        update: {
          name: data.name,
          slug: data.slug,
          image_url: data.image_url ?? "",
        },
      });

      await transaction.workspaceMember.upsert({
        where: {
          userId_workspaceId: {
            userId: data.created_by,
            workspaceId: data.id,
          },
        },
        create: {
          userId: data.created_by,
          workspaceId: data.id,
          role: "ADMIN",
        },
        update: { role: "ADMIN" },
      });
    });
  },
);

// Inngest Functions to update workflow data from a database
const syncWorkspaceUpdation = inngest.createFunction(
  {
    id: "update-workspace-from-clerk",
    triggers: [{ event: "clerk/organization.updated" }],
  },
  /**
   * Updates an existing workspace's name, slug, and image from Clerk.
   * @throws {Error} If the database operation fails, including when the workspace is absent.
   */
  async ({ event }) => {
    const { data } = event;

    await prisma.workspace.update({
      where: {
        id: data.id,
      },
      data: {
        name: data.name,
        slug: data.slug,
        image_url: data.image_url ?? "",
      },
    });
  },
);

// Inngest Functions to delete workflow data from a database
const syncWorkspaceDeletion = inngest.createFunction(
  {
    id: "delete-workspace-from-clerk",
    triggers: [{ event: "clerk/organization.deleted" }],
  },
  /**
   * Deletes matching workspaces; an absent workspace is a no-op.
   * @throws {Error} If the database operation fails.
   */
  async ({ event }) => {
    const { data } = event;

    await prisma.workspace.deleteMany({
      where: {
        id: data.id,
      },
    });
  },
);

// Inngest Functions to save workflow member data to a database
const syncWorkspaceMemberCreation = inngest.createFunction(
  {
    id: "create-workspace-member-from-clerk",
    triggers: [{ event: "clerk/organizationInvitation.accepted" }],
  },
  /**
   * Creates or updates the accepted invitation's workspace membership and role.
   * @throws {Error} If the role is unsupported or the database operation fails.
   */
  async ({ event }) => {
    const { data } = event;
    await prisma.workspaceMember.upsert({
      where: {
        userId_workspaceId: {
          userId: data.user_id,
          workspaceId: data.organization_id,
        },
      },
      update: {
        userId: data.user_id,
        workspaceId: data.organization_id,
        role: getWorkspaceMemberRole(data),
      },
      create: {
        userId: data.user_id,
        workspaceId: data.organization_id,
        role: getWorkspaceMemberRole(data),
      },
    });
  },
);

export const functions = [
  syncUserCreation,
  syncUserDeletion,
  syncUserUpdation,
  syncWorkspaceCreation,
  syncWorkspaceUpdation,
  syncWorkspaceDeletion,
  syncWorkspaceMemberCreation,
];
