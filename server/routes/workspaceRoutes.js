import { Router } from "express";
import {
  addMembers,
  getUserWorkspaces,
} from "../controllers/workspaceControllers.js";

const workspaceRoutes = Router();

workspaceRoutes.get("/", getUserWorkspaces);
workspaceRoutes.post("/add-member", addMembers);

export default workspaceRoutes;