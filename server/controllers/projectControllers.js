import prisma from "../config/prisma.js";

const projectStatuses = [
  "ACTIVE",
  "PLANNING",
  "COMPLETED",
  "ON_HOLD",
  "CANCELLED",
];
const priorities = ["LOW", "MEDIUM", "HIGH"];
const isValidDate = (value) =>
  value == null ||
  value === "" ||
  (typeof value === "string" && !Number.isNaN(new Date(value).getTime()));

const getWorkspaceMembers = async (workspaceId) =>
  prisma.workspaceMember.findMany({
    where: { workspaceId },
    include: { user: true },
  });

const resolveProjectMembers = (members, teamMembers, teamLead) => {
  const requestedEmails = new Set(teamMembers ?? []);

  if (teamLead) {
    requestedEmails.add(teamLead);
  }

  const selectedMembers = members.filter((member) =>
    requestedEmails.has(member.user.email),
  );

  if (selectedMembers.length !== requestedEmails.size) {
    return null;
  }

  const lead = teamLead
    ? selectedMembers.find((member) => member.user.email === teamLead)?.user
    : null;

  return lead ? { selectedMembers, lead } : null;
};

const getProjectResponse = (id) =>
  prisma.project.findUnique({
    where: { id },
    include: {
      members: { include: { user: true } },
      tasks: {
        include: { assignee: true, comments: { include: { user: true } } },
      },
      owner: true,
    },
  });

// Create a new project
export const createProject = async (req, res) => {
  try {
    const { userId } = await req.auth();
    const {
      workspaceId,
      description,
      name,
      status,
      start_date,
      end_date,
      team_members,
      team_lead,
      progress,
      priority,
    } = req.body ?? {};

    if (
      !workspaceId ||
      typeof name !== "string" ||
      !name.trim() ||
      !team_lead
    ) {
      return res.status(400).json({
        message: "Workspace, project name, and project lead are required.",
      });
    }

    if (!Array.isArray(team_members ?? [])) {
      return res.status(400).json({ message: "Team members must be an array." });
    }

    if (!isValidDate(start_date) || !isValidDate(end_date)) {
      return res.status(400).json({ message: "Project dates are invalid." });
    }

    if (status !== undefined && !projectStatuses.includes(status)) {
      return res.status(400).json({ message: "Invalid project status." });
    }

    if (priority !== undefined && !priorities.includes(priority)) {
      return res.status(400).json({ message: "Invalid project priority." });
    }

    if (
      progress !== undefined &&
      (!Number.isInteger(progress) || progress < 0 || progress > 100)
    ) {
      return res
        .status(400)
        .json({ message: "Project progress must be between 0 and 100." });
    }

    if (start_date && end_date && new Date(end_date) < new Date(start_date)) {
      return res
        .status(400)
        .json({ message: "End date cannot be before start date." });
    }

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: { members: { include: { user: true } } },
    });

    if (!workspace) {
      return res.status(404).json({ message: "Workspace not found." });
    }

    if (
      !workspace.members.some(
        (member) => member.userId === userId && member.role === "ADMIN",
      )
    ) {
      return res.status(403).json({
        message: "You are not authorized to create a project in this workspace.",
      });
    }

    const resolvedMembers = resolveProjectMembers(
      workspace.members,
      team_members,
      team_lead,
    );

    if (!resolvedMembers) {
      return res.status(400).json({
        message: "The project lead and team members must belong to the workspace.",
      });
    }

    const project = await prisma.$transaction(async (transaction) => {
      const createdProject = await transaction.project.create({
        data: {
          workspaceId,
          name: name.trim(),
          description,
          status,
          priority,
          progress,
          team_lead: resolvedMembers.lead.id,
          start_date: start_date ? new Date(start_date) : null,
          end_date: end_date ? new Date(end_date) : null,
          members: {
            create: resolvedMembers.selectedMembers.map(({ userId }) => ({
              userId,
            })),
          },
        },
      });

      return createdProject;
    });

    const projectWithMembers = await getProjectResponse(project.id);

    return res.status(201).json({
      message: "Project created successfully",
      project: projectWithMembers,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: error.code || error.message });
  }
};

// Update a project
export const updateProject = async (req, res) => {
  try {
    const { userId } = await req.auth();
    const {
      id,
      workspaceId,
      description,
      name,
      status,
      start_date,
      end_date,
      team_members,
      team_lead,
      progress,
      priority,
    } = req.body ?? {};

    if (!id) {
      return res.status(400).json({ message: "Project ID is required." });
    }

    if (
      name !== undefined &&
      (typeof name !== "string" || !name.trim())
    ) {
      return res.status(400).json({ message: "Project name cannot be empty." });
    }

    if (
      team_members !== undefined &&
      (!Array.isArray(team_members) ||
        team_members.some((email) => typeof email !== "string"))
    ) {
      return res.status(400).json({ message: "Team members must be an array of emails." });
    }

    if (!isValidDate(start_date) || !isValidDate(end_date)) {
      return res.status(400).json({ message: "Project dates are invalid." });
    }

    if (status !== undefined && !projectStatuses.includes(status)) {
      return res.status(400).json({ message: "Invalid project status." });
    }

    if (priority !== undefined && !priorities.includes(priority)) {
      return res.status(400).json({ message: "Invalid project priority." });
    }

    if (
      progress !== undefined &&
      (!Number.isInteger(progress) || progress < 0 || progress > 100)
    ) {
      return res
        .status(400)
        .json({ message: "Project progress must be between 0 and 100." });
    }

    if (start_date && end_date && new Date(end_date) < new Date(start_date)) {
      return res
        .status(400)
        .json({ message: "End date cannot be before start date." });
    }

    const project = await prisma.project.findUnique({
      where: { id },
      include: {
        members: { include: { user: true } },
        workspace: { include: { members: { include: { user: true } } } },
      },
    });

    if (!project) {
      return res.status(404).json({ message: "Project not found." });
    }

    if (workspaceId && workspaceId !== project.workspaceId) {
      return res
        .status(400)
        .json({ message: "Projects cannot be moved to another workspace." });
    }

    const isWorkspaceAdmin = project.workspace.members.some(
      (member) => member.userId === userId && member.role === "ADMIN",
    );

    if (!isWorkspaceAdmin && project.team_lead !== userId) {
      return res
        .status(403)
        .json({ message: "You are not authorized to update this project." });
    }

    if ((team_members !== undefined || team_lead !== undefined) && !isWorkspaceAdmin) {
      return res.status(403).json({
        message: "Only a workspace admin can change project members or lead.",
      });
    }

    let resolvedMembers;
    if (team_members !== undefined || team_lead !== undefined) {
      const requestedLead =
        team_lead ??
        project.workspace.members.find(
          (member) => member.userId === project.team_lead,
        )?.user.email;
      const members = await getWorkspaceMembers(project.workspaceId);
      resolvedMembers = resolveProjectMembers(
        members,
        team_members ?? project.members.map(({ user }) => user.email),
        requestedLead,
      );

      if (!resolvedMembers) {
        return res.status(400).json({
          message: "The project lead and team members must belong to the workspace.",
        });
      }
    }

    await prisma.$transaction(async (transaction) => {
      await transaction.project.update({
        where: { id },
        data: {
          ...(description !== undefined && { description }),
          ...(name !== undefined && { name: name.trim() }),
          ...(status !== undefined && { status }),
          ...(priority !== undefined && { priority }),
          ...(progress !== undefined && { progress }),
          ...(start_date !== undefined && {
            start_date: start_date ? new Date(start_date) : null,
          }),
          ...(end_date !== undefined && {
            end_date: end_date ? new Date(end_date) : null,
          }),
          ...(resolvedMembers && { team_lead: resolvedMembers.lead.id }),
        },
      });

      if (resolvedMembers) {
        await transaction.projectMember.deleteMany({ where: { projectId: id } });
        await transaction.projectMember.createMany({
          data: resolvedMembers.selectedMembers.map(({ userId: memberId }) => ({
            projectId: id,
            userId: memberId,
          })),
        });
      }
    });

    const updatedProject = await getProjectResponse(id);
    return res
      .status(200)
      .json({ message: "Project updated successfully", project: updatedProject });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: error.code || error.message });
  }
};

// Add a member to a project
export const addMembersToProject = async (req, res) => {
  try {
    const { userId } = await req.auth();
    const { projectId } = req.params;
    const { email } = req.body ?? {};

    if (typeof email !== "string" || !email.trim()) {
      return res.status(400).json({ message: "Member email is required." });
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        members: { include: { user: true } },
        workspace: { include: { members: true } },
      },
    });

    if (!project) {
      return res.status(404).json({ message: "Project not found." });
    }

    if (project.team_lead !== userId) {
      return res
        .status(403)
        .json({ message: "Only the project lead can add project members." });
    }

    const user = await prisma.user.findUnique({
      where: { email: email.trim() },
    });
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    if (!project.workspace.members.some((member) => member.userId === user.id)) {
      return res
        .status(400)
        .json({ message: "Project members must belong to the workspace." });
    }

    const member = await prisma.projectMember.upsert({
      where: { userId_projectId: { userId: user.id, projectId } },
      create: { userId: user.id, projectId },
      update: {},
      include: { user: true },
    });

    return res.status(200).json({ member, message: "Member added successfully." });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: error.code || error.message });
  }
};
