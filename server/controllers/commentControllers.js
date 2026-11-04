import prisma from "../config/prisma.js";

// Add comment
export const addComment = async (req, res) => {
  try {
    const { userId } = await req.auth();
    const { content, taskId } = req.body ?? {};

    if (
      typeof taskId !== "string" ||
      !taskId ||
      typeof content !== "string" ||
      !content.trim()
    ) {
      return res.status(400).json({ message: "Task and comment content are required." });
    }

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        project: {
          select: {
            team_lead: true,
            members: { select: { userId: true } },
          },
        },
      },
    });

    if (!task) {
      return res.status(404).json({ message: "Task not found." });
    }

    if (
      task.project.team_lead !== userId &&
      !task.project.members.some((member) => member.userId === userId)
    ) {
      return res.status(403).json({ message: "You are not a member of this project." });
    }

    const comment = await prisma.comment.create({
      data: {
        taskId,
        content: content.trim(),
        userId,
      },
      include: { user: true },
    });

    return res.status(201).json({ comment });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

// Get comments for task
export const getTaskComments = async (req, res) => {
  try {
    const { userId } = await req.auth();
    const { taskId } = req.params;
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        project: {
          select: {
            team_lead: true,
            members: { select: { userId: true } },
          },
        },
      },
    });

    if (!task) {
      return res.status(404).json({ message: "Task not found." });
    }

    if (
      task.project.team_lead !== userId &&
      !task.project.members.some((member) => member.userId === userId)
    ) {
      return res.status(403).json({ message: "You are not a member of this project." });
    }

    const comments = await prisma.comment.findMany({
      where: { taskId },
      include: { user: true },
      orderBy: { createdAt: "asc" },
    });

    return res.status(200).json({ comments });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Internal server error." });
  }
};
