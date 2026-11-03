import prisma from "../config/prisma.js";
import { inngest } from "../inngest/index.js";

const taskTypes = ["TASK", "BUG", "FEATURE", "IMPROVEMENT", "OTHER"];
const taskStatuses = ["TODO", "IN_PROGRESS", "DONE"];
const priorities = ["LOW", "MEDIUM", "HIGH"];
const isValidDate = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  !Number.isNaN(new Date(value).getTime());

const getProjectForTask = (projectId) =>
  prisma.project.findUnique({
    where: { id: projectId },
    include: { members: true },
  });

const canAssignTask = (project, assigneeId) =>
  assigneeId === project.team_lead ||
  project.members.some((member) => member.userId === assigneeId);

// Create a task
export const createTask = async (req, res) => {
  try {
    const { userId } = await req.auth();
    const {
      projectId,
      title,
      description,
      type,
      status,
      priority,
      assigneeId,
      due_date,
    } = req.body ?? {};

    if (
      !projectId ||
      typeof title !== "string" ||
      !title.trim() ||
      !isValidDate(due_date)
    ) {
      return res.status(400).json({
        message: "Project, task title, and a valid due date are required.",
      });
    }

    if (type !== undefined && !taskTypes.includes(type)) {
      return res.status(400).json({ message: "Invalid task type." });
    }

    if (status !== undefined && !taskStatuses.includes(status)) {
      return res.status(400).json({ message: "Invalid task status." });
    }

    if (priority !== undefined && !priorities.includes(priority)) {
      return res.status(400).json({ message: "Invalid task priority." });
    }

    const project = await getProjectForTask(projectId);
    if (!project) {
      return res.status(404).json({ message: "Project not found." });
    }

    if (project.team_lead !== userId) {
      return res
        .status(403)
        .json({ message: "Only the project lead can create tasks." });
    }

    const taskAssigneeId = assigneeId || project.team_lead;
    if (!canAssignTask(project, taskAssigneeId)) {
      return res.status(400).json({
        message: "The assignee must be a member of the project.",
      });
    }

    const task = await prisma.task.create({
      data: {
        projectId,
        title: title.trim(),
        description,
        type,
        priority,
        assigneeId: taskAssigneeId,
        status,
        due_date: new Date(due_date),
      },
      include: { assignee: true },
    });

    await inngest.send({
      name: "app/task.assigned",
      data: { taskId: task.id, origin: req.get("origin") },
    });

    return res
      .status(201)
      .json({ task, message: "Task created successfully." });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: error.code || error.message });
  }
};

// Update a task
export const updateTask = async (req, res) => {
  try {
    const { userId } = await req.auth();
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ message: "Task ID is required." });
    }

    const task = await prisma.task.findUnique({ where: { id } });
    if (!task) {
      return res.status(404).json({ message: "Task not found." });
    }

    const project = await getProjectForTask(task.projectId);
    if (!project) {
      return res.status(404).json({ message: "Project not found." });
    }

    if (project.team_lead !== userId) {
      return res
        .status(403)
        .json({ message: "Only the project lead can update tasks." });
    }

    const {
      title,
      description,
      type,
      status,
      priority,
      assigneeId,
      due_date,
    } = req.body ?? {};
    if (title !== undefined && (typeof title !== "string" || !title.trim())) {
      return res.status(400).json({ message: "Task title cannot be empty." });
    }

    if (due_date !== undefined && !isValidDate(due_date)) {
      return res.status(400).json({ message: "A valid due date is required." });
    }

    if (type !== undefined && !taskTypes.includes(type)) {
      return res.status(400).json({ message: "Invalid task type." });
    }

    if (status !== undefined && !taskStatuses.includes(status)) {
      return res.status(400).json({ message: "Invalid task status." });
    }

    if (priority !== undefined && !priorities.includes(priority)) {
      return res.status(400).json({ message: "Invalid task priority." });
    }

    if (assigneeId !== undefined && !canAssignTask(project, assigneeId)) {
      return res.status(400).json({
        message: "The assignee must be a member of the project.",
      });
    }

    const updatedTask = await prisma.task.update({
      where: { id },
      data: {
        ...(title !== undefined && { title: title.trim() }),
        ...(description !== undefined && { description }),
        ...(type !== undefined && { type }),
        ...(status !== undefined && { status }),
        ...(priority !== undefined && { priority }),
        ...(assigneeId !== undefined && { assigneeId }),
        ...(due_date !== undefined && { due_date: new Date(due_date) }),
      },
      include: { assignee: true },
    });

    if (assigneeId && assigneeId !== task.assigneeId) {
      await inngest.send({
        name: "app/task.assigned",
        data: { taskId: updatedTask.id, origin: req.get("origin") },
      });
    }

    return res
      .status(200)
      .json({ task: updatedTask, message: "Task updated successfully." });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: error.code || error.message });
  }
};

// Delete tasks
export const deleteTask = async (req, res) => {
  try {
    const { userId } = await req.auth();
    const { tasksIds } = req.body ?? {};

    if (
      !Array.isArray(tasksIds) ||
      tasksIds.length === 0 ||
      tasksIds.some((id) => typeof id !== "string" || !id)
    ) {
      return res
        .status(400)
        .json({ message: "Provide one or more valid task IDs." });
    }

    const uniqueTaskIds = [...new Set(tasksIds)];
    const tasks = await prisma.task.findMany({
      where: { id: { in: uniqueTaskIds } },
      select: { id: true, projectId: true },
    });

    if (tasks.length !== uniqueTaskIds.length) {
      return res.status(404).json({ message: "One or more tasks were not found." });
    }

    const projectIds = [...new Set(tasks.map((task) => task.projectId))];
    const projects = await prisma.project.findMany({
      where: { id: { in: projectIds } },
      select: { id: true, team_lead: true },
    });

    if (projects.some((project) => project.team_lead !== userId)) {
      return res
        .status(403)
        .json({ message: "Only the project lead can delete tasks." });
    }

    const result = await prisma.task.deleteMany({
      where: { id: { in: uniqueTaskIds } },
    });

    return res.status(200).json({
      message: "Tasks deleted successfully.",
      count: result.count,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: error.code || error.message });
  }
};
