import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export function createJournal(directory) {
  const files = {
    lots: join(directory, 'lots.json'),
    observations: join(directory, 'observations.json')
  };
  let queue = Promise.resolve();

  async function read(kind) {
    try {
      const value = JSON.parse(await readFile(files[kind], 'utf8'));
      if (!Array.isArray(value)) {
        throw new Error(`El archivo ${kind} no contiene una lista.`);
      }
      return value;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  function mutate(kind, update) {
    const operation = queue.then(async () => {
      const entries = await read(kind);
      const result = update(entries);
      await mkdir(directory, { recursive: true });
      const temporary = join(directory, `.${kind}-${randomUUID()}.tmp`);

      try {
        await writeFile(temporary, JSON.stringify(entries), { flag: 'wx' });
        await rename(temporary, files[kind]);
      } finally {
        await unlink(temporary).catch(error => {
          if (error.code !== 'ENOENT') {
            throw error;
          }
        });
      }

      return result;
    });

    queue = operation.catch(() => {});
    return operation;
  }

  return {
    async ensureDefault() {
      const lots = await read('lots');
      if (!lots.length) {
        await this.addLot('Lote 1');
      }
    },

    async listLots() {
      await queue;
      return (await read('lots')).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },

    addLot(name, notes = '') {
      return mutate('lots', entries => {
        const lot = {
          id: randomUUID(),
          name: name.slice(0, 120),
          ...(notes ? { notes: notes.slice(0, 600) } : {}),
          createdAt: new Date().toISOString()
        };
        entries.push(lot);
        return lot;
      });
    },

    removeLot(id) {
      return mutate('lots', entries => {
        const index = entries.findIndex(item => item.id === id);
        if (index < 0) {
          return false;
        }
        entries.splice(index, 1);
        return true;
      });
    },

    async getLot(id) {
      return (await this.listLots()).find(lot => lot.id === id);
    },

    async listObservations() {
      await queue;
      return read('observations');
    },

    addObservation(data) {
      return mutate('observations', entries => {
        const observation = { ...data, id: randomUUID(), createdAt: new Date().toISOString() };
        entries.push(observation);
        return observation;
      });
    }
  };
}
