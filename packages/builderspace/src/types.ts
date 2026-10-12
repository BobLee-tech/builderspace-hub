/** A top-level project. Becomes one Hub workspace, so access is granted per project. */
export interface ProjectDef {
  key: string;
  name: string;
  /** Workspace URL slug; also how an existing workspace is recognised on re-runs. */
  slug: string;
  description?: string;
}

/** A function inside every project (开发 / 运营 / 营销). Becomes one board per project. */
export interface FunctionDef {
  key: string;
  name: string;
}

export interface TaskDef {
  /** `ProjectDef.key` */
  project: string;
  /** `FunctionDef.key` */
  function: string;
  title: string;
  /** Plain text; one paragraph per line. */
  description?: string;
  labels?: string[];
}

export interface HubStructure {
  /** Columns of every board, left to right. New tasks land in the first one. */
  lists: string[];
  /** Labels available on every board. */
  labels: string[];
  functions: FunctionDef[];
  projects: ProjectDef[];
  tasks: TaskDef[];
}

export interface WorkspaceSummary {
  publicId: string;
  name: string;
  slug: string;
}

export interface BoardSummary {
  publicId: string;
  name: string;
  lists: { publicId: string; name: string; index: number }[];
  labels: { publicId: string; name: string }[];
}

export interface CreateWorkspaceInput {
  name: string;
  slug: string;
  description?: string;
}

export interface CreateBoardInput {
  name: string;
  lists: string[];
  labels: string[];
}

export interface CreateCardInput {
  title: string;
  description: string;
  listPublicId: string;
  labelPublicIds: string[];
}

/** The slice of the Hub REST API the seed needs. */
export interface HubClient {
  listWorkspaces(): Promise<WorkspaceSummary[]>;
  createWorkspace(input: CreateWorkspaceInput): Promise<WorkspaceSummary>;
  listBoards(workspacePublicId: string): Promise<BoardSummary[]>;
  createBoard(
    workspacePublicId: string,
    input: CreateBoardInput,
  ): Promise<{ publicId: string; name: string }>;
  listCardTitles(boardPublicId: string): Promise<string[]>;
  createCard(input: CreateCardInput): Promise<{ publicId: string }>;
}

export interface SeedTally {
  created: string[];
  existing: string[];
}

export interface SeedReport {
  dryRun: boolean;
  workspaces: SeedTally;
  boards: SeedTally;
  cards: SeedTally;
  warnings: string[];
}
