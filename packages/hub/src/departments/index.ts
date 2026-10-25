export {
  canManageDepartments,
  DEPARTMENT_NAME_MAX_LENGTH,
} from "./department.policy";
export type { DepartmentDirectory } from "./department.service";
export {
  createDepartment,
  getDepartmentDirectory,
  moveDepartment,
  renameDepartment,
  setDepartmentMember,
} from "./department.service";
