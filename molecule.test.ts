import { reaction } from "./molecule";

describe("reaction", () => {
  describe("reaction generator", () => {
    const getAtom = (trigger = "hi", errorTrigger = "no!!!") => async (props: {
      projectId?: string;
      first?: string;
      second?: string;
    }) => {
      const { projectId, second } = props;
      if (second === trigger) {
        return "got it";
      }
      if (projectId === trigger) {
        return "bye";
      }
      if (projectId === errorTrigger) {
        throw new Error(errorTrigger);
      }
      return projectId ? projectId : undefined;
    };

    it("should start by executing only the first atom group", async () => {
      const chemical = reaction([
        {
          first: getAtom(),
        },
        {
          second: getAtom("2", "yes?"),
          third: getAtom("hi", "maybe?"),
        },
      ]);

      // start the reaction
      chemical.next();

      const firstReaction = await chemical.next({
        projectId: "hi",
      });

      // first the promise should be yielded
      expect(firstReaction.value).toEqual({
        projectId: "hi",
        first: Promise.resolve("bye"),
      });

      const resolvedFirstReaction = await chemical.next({
        projectId: "hi",
      });

      expect(resolvedFirstReaction.value).toEqual({
        projectId: "hi",
        first: "bye",
      });
    });

    it("should execute a parallel group in parallel", async () => {
      const chemical = reaction([
        {
          second: getAtom("2", "yes?"),
          third: getAtom("hi", "maybe?"),
        },
      ]);

      // start the reaction
      chemical.next();

      const firstReaction = await chemical.next({
        projectId: "hi",
      });

      // first the promise should be yielded
      expect(firstReaction.value).toEqual({
        projectId: "hi",
        second: Promise.resolve("hi"),
        third: Promise.resolve("bye"),
      });

      const resolvedFirstReaction = await chemical.next({
        projectId: "hi",
      });

      expect(resolvedFirstReaction.value).toEqual({
        projectId: "hi",
        second: "hi",
        third: "bye",
      });
    });

    it("should execute sequential groups in sequence", async () => {
      const chemical = reaction([
        {
          second: getAtom(),
        },
        {
          third: getAtom("bye", "maybe?"),
        },
      ]);

      // start the reaction
      chemical.next();

      const props = {
        projectId: "hi",
      };
      const firstReaction = await chemical.next(props);

      // first the promise should be yielded
      expect(firstReaction.value).toEqual({
        projectId: "hi",
        second: Promise.resolve("bye"),
      });

      const resolvedFirstReaction = await chemical.next(props);

      expect(resolvedFirstReaction.value).toEqual({
        projectId: "hi",
        second: "bye",
      });

      const secondReaction = await chemical.next(props);

      expect(secondReaction.value).toEqual({
        projectId: "hi",
        second: "bye",
        third: Promise.resolve("got it"),
      });

      const resolvedSecondReaction = await chemical.next(props);

      expect(resolvedSecondReaction.value).toEqual({
        projectId: "hi",
        second: "bye",
        third: "got it",
      });
    });

    it("should skip/handle errors in an atom result", async () => {
      const chemical = reaction([
        {
          first: getAtom(),
        },
        {
          second: getAtom("bye", "maybe?"),
        },
      ]);
      chemical.next();
      const props = {
        projectId: "no!!!",
      };
      const firstReaction = await chemical.next(props);

      const rejection = Promise.reject("no!!!");
      expect(firstReaction.value).toEqual({
        projectId: "no!!!",
        first: rejection,
      });

      // throw away the error so the console doesn't get polluted
      await rejection.catch((e) => e);

      const resolvedFirstReaction = await chemical.next(props);
      expect(resolvedFirstReaction.value).toEqual({
        projectId: "no!!!",
        first: new Error("no!!!"),
      });

      // the second group should not be called
      const skipSecondReaction = await chemical.next(props);
      expect(skipSecondReaction.value).toEqual({
        projectId: "no!!!",
        first: new Error("no!!!"),
      });
    });
  });
});
