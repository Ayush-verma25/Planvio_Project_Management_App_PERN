import { Router } from "express";
import {
  addMembersToProject,
  createProject,
  updateProject,
} from "../controllers/projectControllers.js";

const projectRouter = Router();

projectRouter.post("/", createProject);
projectRouter.put("/", updateProject);
projectRouter.post("/:projectId/addMember", addMembersToProject);

export default projectRouter;