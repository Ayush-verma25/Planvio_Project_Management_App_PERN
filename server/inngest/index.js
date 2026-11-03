import { Inngest } from "inngest";
import prisma from "../config/prisma.js";
import sendEmail from "../config/nodemailer.js";

// Create a client to send and receive events
export const inngest = new Inngest({ id: "Project-management" });

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

const getWorkspaceMemberRole = (data) => {
  const rawRole =
    typeof data.role === "string" ? data.role.split(":").at(-1) : data.role_name;
  const role = (
    rawRole ??
    "MEMBER"
  ).toUpperCase();

  if (role === "ADMIN" || role === "MEMBER") {
    return role;
  }

  throw new Error(`Unsupported Clerk organization role: ${role}`);
};

// Inngest Function to save user data to a database
const syncUserCreation = inngest.createFunction(
  { id: "sync-user-from-clerk", triggers: [{ event: "clerk/user.created" }] },
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
  async ({ event }) => {
    const { data } = event;
    if (!data.id || !data.created_by) {
      throw new Error("Clerk organization creation is missing its ID or creator.");
    }

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
    triggers: [{ event: "clerk/organizationMembership.created" }],
  },
  async ({ event }) => {
    const { data } = event;
    const userId = data.public_user_data?.user_id ?? data.user_id;
    const workspaceId = data.organization_id ?? data.organization?.id;

    if (!userId || !workspaceId) {
      throw new Error(
        "Clerk organization membership is missing its user or organization ID.",
      );
    }

    await prisma.workspaceMember.upsert({
      where: {
        userId_workspaceId: {
          userId,
          workspaceId,
        },
      },
      update: {
        userId,
        workspaceId,
        role: getWorkspaceMemberRole(data),
      },
      create: {
        userId,
        workspaceId,
        role: getWorkspaceMemberRole(data),
      },
    });
  },
);

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });

const createTaskEmail = (task, origin, isReminder = false) => {
  let taskUrl = "";
  if (origin) {
    const url = new URL("/taskDetails", origin);
    url.searchParams.set("projectId", task.projectId);
    url.searchParams.set("taskId", task.id);
    taskUrl = url.href;
  }
  const title = escapeHtml(task.title);
  const projectName = task.project.name;
  const projectNameHtml = escapeHtml(projectName);
  const assigneeName = escapeHtml(task.assignee.name);
  const description = escapeHtml(task.description || "No description provided.");
  const dueDate = escapeHtml(new Date(task.due_date).toLocaleDateString());
  const heading = isReminder
    ? `Reminder for ${projectName}`
    : `New task assignment in ${projectName}`;

  return {
    subject: heading,
    body: `<div style="max-width: 600px;">
      <h2>Hi ${assigneeName},</h2>
      <p style="font-size: 16px;">${isReminder ? "This task is due soon:" : "You've been assigned a new task:"}</p>
      <p style="font-size: 14px;">Project: ${projectNameHtml}</p>
      <p style="font-size: 18px; font-weight: bold; color: #007bff; margin: 8px 0;">${title}</p>
      <div style="border: 1px solid #ddd; padding: 12px 16px; border-radius: 6px; margin-bottom: 30px;">
        <p style="margin: 6px 0;"><strong>Description:</strong> ${description}</p>
        <p style="margin: 6px 0;"><strong>Due date:</strong> ${dueDate}</p>
      </div>
      ${taskUrl ? `<a href="${escapeHtml(taskUrl)}" style="background-color: #007bff; padding: 12px 24px; border-radius: 5px; color: #fff; font-weight: 600; font-size: 16px; text-decoration: none;">View task</a>` : ""}
      <p style="margin-top: 20px; font-size: 14px; color: #6c757d;">Please review and complete it before the due date.</p>
    </div>`,
  };
};

// Send an assignment email and a reminder on the task's due date.
const sendTaskAssignmentEmail = inngest.createFunction(
  {
    id: "send-task-assignment-mail",
    triggers: [{ event: "app/task.assigned" }],
  },
  async ({ event, step }) => {
    const { taskId, origin } = event.data ?? {};
    if (!taskId) {
      throw new Error("Task assignment event is missing its task ID.");
    }

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { assignee: true, project: true },
    });

    if (!task) {
      return;
    }

    await step.run("send-task-assignment-mail", async () =>
      sendEmail({
        to: task.assignee.email,
        ...createTaskEmail(task, origin),
      }),
    );

    const dueDate = new Date(task.due_date);
    const now = new Date();
    const isDueToday =
      dueDate.getFullYear() === now.getFullYear() &&
      dueDate.getMonth() === now.getMonth() &&
      dueDate.getDate() === now.getDate();

    if (dueDate <= now || isDueToday) {
      return;
    }

    await step.sleepUntil("wait-for-the-due-date", dueDate);

    const reminderTask = await step.run(
      "check-if-task-is-completed",
      async () => {
        const currentTask = await prisma.task.findUnique({
          where: { id: taskId },
          include: { assignee: true, project: true },
        });

        return currentTask?.status === "DONE" ? null : currentTask;
      },
    );

    if (reminderTask) {
      await step.run("send-task-reminder-mail", async () =>
        sendEmail({
          to: reminderTask.assignee.email,
          ...createTaskEmail(reminderTask, origin, true),
        }),
      );
    }
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
  sendTaskAssignmentEmail,
];
