import { catalyze, ChainReactionState } from "./catalyze";
import { Molecule, MoleculeProps } from "./molecule";

describe("poll", () => {
  const getCatalzer = (atoms: Molecule) => {
    const generator = catalyze(atoms);
    // start the generator
    generator.next();
    return generator;
  };

  const refresh = (a: any, prev: any) => {
    const p = Promise.resolve(a);
    p.previousValue = prev;
    return p;
  };

  const testWithTimeout = async (test: () => Promise<void>) => {
    const actualTimeout = setTimeout;
    try {
      global.setTimeout = window.setTimeout = jest.fn((resolver: any) => {
        resolver();
      }) as any;
    } finally {
      global.setTimeout = window.setTimeout = actualTimeout;
    }
  };

  it("should yield the pending promises first, then the resolved values", async () => {
    const myPoll = getCatalzer([
      {
        first: async () => "first",
      },
      {
        second: async ({ first: f }: { first: string }) => {
          return f ? `second ${f}` : undefined;
        },
        third: async ({ first: f }: { first: string }) => {
          return f ? `third ${f}` : undefined;
        },
      },
    ]);

    const props = { projectId: "hi" };

    const promiseFirstReaction = await myPoll.next(props);
    expect(promiseFirstReaction.value[1]).toEqual({
      ...props,
      first: Promise.resolve("first"),
    });

    const resolvedFirstReaction = await myPoll.next(props);
    expect(resolvedFirstReaction.value[1]).toEqual({
      ...props,
      first: "first",
    });

    const promiseSecondReaction = await myPoll.next(props);
    expect(promiseSecondReaction.value[1]).toEqual({
      ...props,
      first: "first",
      second: Promise.resolve("second first"),
      third: Promise.resolve("third first"),
    });

    const resolvedSecondReaction = await myPoll.next(props);
    expect(resolvedSecondReaction.value[1]).toEqual({
      ...props,
      first: "first",
      second: "second first",
      third: "third first",
    });
  });

  it('should yield "executing" and then "finished" state when a reaction has fully executed successfully', async () => {
    const myPoll = getCatalzer([
      {
        first: async () => "first",
      },
      {
        second: async ({ first: f }: { first: string }) => {
          return f ? `second ${f}` : undefined;
        },
        third: async ({ first: f }: { first: string }) => {
          return f ? `third ${f}` : undefined;
        },
      },
    ]);

    const props = { projectId: "hi" };

    let reaction: IteratorResult<[ChainReactionState, MoleculeProps], void>;
    do {
      reaction = await myPoll.next(props);
    } while (reaction.value[0] === "executing");
    expect(reaction.value[0]).toBe("finished");
    expect(reaction.value[1]).toEqual({
      ...props,
      first: "first",
      second: "second first",
      third: "third first",
    });
  });

  it("should poll after a reaction finishes", async () => {
    await testWithTimeout(async () => {
      const myPoll = getCatalzer([
        {
          first: async () => "first",
        },
      ]);

      const props = { projectId: "hi" };

      let reaction: IteratorResult<[ChainReactionState, MoleculeProps], void>;
      do {
        reaction = await myPoll.next(props);
      } while (reaction.value[0] === "executing");
      expect(reaction.value[0]).toBe("finished");

      // start over
      reaction = await myPoll.next(props);

      expect(setTimeout).toHaveBeenCalledTimes(1);

      do {
        reaction = await myPoll.next(props);
      } while (reaction.value[0] === "executing");
      expect(reaction.value[0]).toBe("finished");

      // start over
      reaction = await myPoll.next(props);

      expect(setTimeout).toHaveBeenCalledTimes(2);
    });
  });

  it("should restart from the beginning", async () => {
    await testWithTimeout(async () => {
      const myPoll = getCatalzer([
        {
          first: async () => "first",
        },
      ]);

      const props = { projectId: "hi" };

      let reaction: IteratorResult<[ChainReactionState, MoleculeProps], void>;
      do {
        reaction = await myPoll.next(props);
      } while (reaction.value[0] === "executing");
      expect(reaction.value[0]).toBe("finished");

      // start over
      reaction = await myPoll.next(props);
      expect(reaction.value).toEqual([
        "executing",
        {
          first: refresh("first", "first"),
          second: "second first",
          third: "third first",
        },
      ]);

      reaction = await myPoll.next(props);
      expect(reaction.value).toEqual([
        "executing",
        {
          first: "first",
          second: refresh("second first", "second first"),
          third: refresh("third first", "third first"),
        },
      ]);
      expect(reaction.value).toEqual([
        "finished",
        {
          ...props,
          first: "first",
          second: "second first",
          third: "third first",
        },
      ]);
    });
  });

  it("should abort on error", async () => {
    const myPoll = getCatalzer([
      {
        first: async () => {
          throw new Error("fail");
        },
      },
      {
        second: async ({ first: f }: { first: string }) => {
          return f ? `second ${f}` : undefined;
        },
        third: async ({ first: f }: { first: string }) => {
          return f ? `third ${f}` : undefined;
        },
      },
    ]);
    const props = { projectId: "project" };

    const promiseReaction = await myPoll.next(props);
    expect(promiseReaction.value[0]).toBe("executing");
    const errorReaction = await myPoll.next(props);
    expect(errorReaction.value).toEqual([
      "error",
      {
        projectId: "project",
        first: new Error("fail"),
      },
    ]);
  });

  it("should abort if dependencies change", async () => {
    await testWithTimeout(async () => {
      const myPoll = getCatalzer([
        {
          first: async () => "first",
        },
        {
          second: async ({ first: f }: { first: string }) => {
            return f ? `second ${f}` : undefined;
          },
          third: async ({ first: f }: { first: string }) => {
            return f ? `third ${f}` : undefined;
          },
        },
      ]);

      const props = { projectId: "hi" };

      const promiseFirstReaction = await myPoll.next(props);
      expect(promiseFirstReaction.value).toEqual({
        ...props,
        first: Promise.resolve("first"),
      });

      const nextProps = { projectId: "changed" };
      const changedReaction = await myPoll.next(nextProps);
      expect(changedReaction.value).toEqual({
        ...props,
        first: "first",
        second: Promise.resolve("second first"),
        third: Promise.resolve("third first"),
      });

      const afterChangeReaction = await myPoll.next(nextProps);
      expect(afterChangeReaction.value).toEqual({
        ...nextProps,
        first: Promise.resolve("first"),
      });

      expect(setTimeout).not.toHaveBeenCalled();
    });
  });
});
