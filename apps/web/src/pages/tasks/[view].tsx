import type { NextPageWithLayout } from "~/pages/_app";
import { getDashboardLayout } from "~/components/Dashboard";
import { TaskBoardPage } from "~/hub/features/tasks/TaskBoardPage";

const Tasks: NextPageWithLayout = () => <TaskBoardPage />;

Tasks.getLayout = (page) => getDashboardLayout(page);

export default Tasks;
