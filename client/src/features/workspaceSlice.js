import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import api from "../configs/api";

export const fetchWorkspaces = createAsyncThunk(
  "workspace/fetchWorkspaces",
  async (token, { rejectWithValue }) => {
    try {
      const { data } = await api.get("/api/workspaces", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const workspaces = Array.isArray(data) ? data : data?.workspaces;

      if (!Array.isArray(workspaces)) {
        return rejectWithValue("The workspaces response must be an array.");
      }

      return {
        workspaces,
        selectedWorkspaceId: localStorage.getItem("currentWorkspaceId"),
      };
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.message ??
          error.message ??
          "Unable to load workspaces.",
      );
    }
  },
);

const initialState = {
  workspaces: [],
  currentWorkspace: null,
  loading: false,
  error: null,
};

const updateCurrentWorkspace = (state, update) => {
  const workspaceId = state.currentWorkspace?.id;

  if (!workspaceId) {
    return;
  }

  const workspace = state.workspaces.find((item) => item.id === workspaceId);

  if (!workspace) {
    state.currentWorkspace = null;
    return;
  }

  update(workspace);
  state.currentWorkspace = workspace;
};

const workspaceSlice = createSlice({
  name: "workspace",
  initialState,
  reducers: {
    startWorkspaceFetch: (state) => {
      state.loading = true;
      state.error = null;
    },
    setWorkspaceFetchError: (state, action) => {
      state.loading = false;
      state.error = action.payload;
    },
    setWorkspaces: (state, action) => {
      state.workspaces = action.payload;
      state.currentWorkspace =
        state.workspaces.find(
          (workspace) => workspace.id === state.currentWorkspace?.id,
        ) ??
        state.workspaces[0] ??
        null;
    },
    setCurrentWorkspace: (state, action) => {
      state.currentWorkspace =
        state.workspaces.find((workspace) => workspace.id === action.payload) ??
        null;
    },
    addWorkspace: (state, action) => {
      const existingIndex = state.workspaces.findIndex(
        (workspace) => workspace.id === action.payload.id,
      );

      if (existingIndex === -1) {
        state.workspaces.push(action.payload);
      } else {
        state.workspaces[existingIndex] = action.payload;
      }

      state.currentWorkspace = action.payload;
    },
    updateWorkspace: (state, action) => {
      state.workspaces = state.workspaces.map((workspace) =>
        workspace.id === action.payload.id ? action.payload : workspace,
      );

      if (state.currentWorkspace?.id === action.payload.id) {
        state.currentWorkspace = action.payload;
      }
    },
    deleteWorkspace: (state, action) => {
      state.workspaces = state.workspaces.filter(
        (workspace) => workspace.id !== action.payload,
      );

      if (state.currentWorkspace?.id === action.payload) {
        state.currentWorkspace = state.workspaces[0] ?? null;
      }
    },
    addProject: (state, action) => {
      updateCurrentWorkspace(state, (workspace) => {
        workspace.projects ??= [];

        const existingIndex = workspace.projects.findIndex(
          (project) => project.id === action.payload.id,
        );

        if (existingIndex === -1) {
          workspace.projects.push(action.payload);
        } else {
          workspace.projects[existingIndex] = action.payload;
        }
      });
    },
    addTask: (state, action) => {
      updateCurrentWorkspace(state, (workspace) => {
        const project = workspace.projects?.find(
          (item) => item.id === action.payload.projectId,
        );

        if (!project) {
          return;
        }

        project.tasks ??= [];

        const existingIndex = project.tasks.findIndex(
          (task) => task.id === action.payload.id,
        );

        if (existingIndex === -1) {
          project.tasks.push(action.payload);
        } else {
          project.tasks[existingIndex] = action.payload;
        }
      });
    },
    updateTask: (state, action) => {
      updateCurrentWorkspace(state, (workspace) => {
        const project = workspace.projects?.find(
          (item) => item.id === action.payload.projectId,
        );

        if (!project?.tasks) {
          return;
        }

        const taskIndex = project.tasks.findIndex(
          (task) => task.id === action.payload.id,
        );

        if (taskIndex !== -1) {
          project.tasks[taskIndex] = action.payload;
        }
      });
    },
    deleteTask: (state, action) => {
      const taskIds = new Set(
        Array.isArray(action.payload) ? action.payload : [action.payload],
      );

      updateCurrentWorkspace(state, (workspace) => {
        for (const project of workspace.projects ?? []) {
          project.tasks = (project.tasks ?? []).filter(
            (task) => !taskIds.has(task.id),
          );
        }
      });
    },
  },
  extraReducers: (builder) => {
    builder.addCase(fetchWorkspaces.pending, (state) => {
      state.loading = true;
      state.error = null;
    });
    builder.addCase(fetchWorkspaces.fulfilled, (state, action) => {
      state.workspaces = action.payload.workspaces;
      state.currentWorkspace =
        state.workspaces.find(
          (workspace) =>
            workspace.id === action.payload.selectedWorkspaceId,
        ) ??
        state.workspaces[0] ??
        null;
      state.loading = false;
    });
    builder.addCase(fetchWorkspaces.rejected, (state, action) => {
      state.loading = false;
      state.error = action.payload ?? action.error.message;
    });
  },
});

export const {
  startWorkspaceFetch,
  setWorkspaceFetchError,
  setWorkspaces,
  setCurrentWorkspace,
  addWorkspace,
  updateWorkspace,
  deleteWorkspace,
  addProject,
  addTask,
  updateTask,
  deleteTask,
} = workspaceSlice.actions;
export default workspaceSlice.reducer;
