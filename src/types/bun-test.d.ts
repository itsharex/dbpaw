declare module "bun:test" {
  export const describe: (...args: any[]) => any;
  export const test: (...args: any[]) => any;
  export const it: typeof test;
  export const expect: (...args: any[]) => any;
}
