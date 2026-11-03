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
    res.status(500).json({ message: error.code || error.message });
  }
};

// Add members to a workspace
export const addMembers = async (req, res) => {
  try {
    const { userId } = await req.auth();
    const { email, workspaceId, role, message } = req.body;

    // check if the user is the owner of the workspace
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (!workspaceId || !role) {
      return res.status(400).json({ message: "Missing required perameters" });
    }

    if (!["ADMIN", "MEMBER"].includes(role)) {
      return res.status(400).json({ message: "Invalid role" });
    }

    // fetch the workspace
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: { members: { members: true } },
    });

    if (!workspace) {
      return res.status(404).json({ message: "Workspace not found" });
    }

    // check creator has admin role
    if (
      !workspace.members.find(
        (member) => member.userId === userId && member.role === "ADMIN",
      )
    ) {
      return res
        .status(401)
        .json({ message: "You do not have Admin priviledges" });
    }
    // Check if user ia already a member of the workspace
    const existingMember = workspace.member.find(
      (member) => member.userId === user.id,
    );

    if (existingMember) {
      return res
        .status(400)
        .json({ message: "User is already a member of the workspace" });
    }

    const member = await prisma.workspaceMember.create({
      data: {
        userId: user.id,
        workspaceId,
        role,
        message,
      },
    });

    res.status(200).json({ message: "Member added successfully", member });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.code || error.message });
  }
};
