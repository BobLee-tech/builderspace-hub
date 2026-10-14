import type { NextPageWithLayout } from "~/pages/_app";
import { getDashboardLayout } from "~/components/Dashboard";
import { HomePage } from "~/hub/features/home/HomePage";

const Home: NextPageWithLayout = () => <HomePage />;

Home.getLayout = (page) => getDashboardLayout(page);

export default Home;
