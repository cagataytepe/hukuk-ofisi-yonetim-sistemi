import { createRepository } from "../repositories/index.js";

let activeRepository = null;

export async function getRepository(options = {}) {
  if (!activeRepository || options.reset) {
    activeRepository = await createRepository(options);
  }
  return activeRepository;
}

export function currentRepository() {
  return activeRepository;
}
