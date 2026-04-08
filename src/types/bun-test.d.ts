declare module "bun:test" {
  export const describe: (...args: any[]) => any;
  export const test: (...args: any[]) => any;
  export const it: typeof test;
  export const beforeEach: (...args: any[]) => any;
  export const afterEach: (...args: any[]) => any;
  export const expect: (...args: any[]) => any;
  export const mock: {
    module: (id: string, factory: () => any) => void;
  };
}

interface ImportMeta {
  dir: string;
}
