import { defineTest } from "polka-cli";

// The front: a quick question it answers itself, research it gives to its skills, and no number
// it did not look up.
export default [
  defineTest({
    name: "gives research to research_company",
    turns: [{ user: "Can you dig into Nvidia for me? I want to know what's going on with them.", expect: { tool: "assign_task" } }],
    criteria: ["The agent says it has started researching Nvidia, and does not claim findings it does not have yet."],
  }),
  defineTest({
    name: "looks a price up instead of guessing",
    turns: [{ user: "What's Apple's stock at right now?", expect: { tool: "stock_snapshot" } }],
    criteria: ["The agent gives the price it looked up, or says it could not check it right now. It never states a price it did not look up."],
  }),
  defineTest({
    name: "says what it can do",
    turns: [{ user: "What can you do?" }],
    criteria: ["The agent says it can research a company and compare companies, and look up a stock's price."],
  }),
];
