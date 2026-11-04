import prisma from "../config/prisma.js";

// Get All workspaces for a user
export const getUserWorkspaces = async (req, res) => {
  try {
    const { userId } = await req.auth();
    const workspaces = await prisma.workspace.findMany({
      where: {
        members: { some: { userId: userId } },
      },
      include: {
        members: { include: { user: true } },
        projects: {
          include: {
            tasks: {
              include: {
                assignee: true,
                comments: { include: { user: true } },
              },
            },
            members: { include: { user: true } },
          },
        },
        owner: true,
      },
    });
    res.status(200).json(workspaces);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal server error." });
  }
};

// Add members to a workspace
export const addMembers = async (req, res) => {
  try {
    const { userId } = await req.auth();
    const { email, workspaceId, role, message } = req.body ?? {};

    if (
      typeof email !== "string" ||
      !email.trim() ||
      typeof workspaceId !== "string" ||
      !workspaceId ||
      !role
    ) {
      return res.status(400).json({ message: "Email, workspace, and role are required." });
    }

    if (!["ADMIN", "MEMBER"].includes(role)) {
      return res.status(400).json({ message: "Invalid role." });
    }

    if (message !== undefined && typeof message !== "string") {
      return res.status(400).json({ message: "Message must be a string." });
    }

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: { members: true },
    });

    if (!workspace) {
      return res.status(404).json({ message: "Workspace not found." });
    }

    if (!workspace.members.some((member) => member.userId === userId && member.role === "ADMIN")) {
      return res.status(403).json({ message: "Workspace admin privileges are required." });
    }

    const user = await prisma.user.findUnique({
      where: { email: email.trim() },
    });

    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    const existingMember = workspace.members.find((member) => member.userId === user.id);

    if (existingMember) {
      return res.status(409).json({ message: "User is already a member of the workspace." });
    }

    const member = await prisma.workspaceMember.create({
      data: {
        userId: user.id,
        workspaceId,
        role,
        message: message ?? "",
      },
    });

    return res.status(201).json({ message: "Member added successfully.", member });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Internal server error." });
  }
};
