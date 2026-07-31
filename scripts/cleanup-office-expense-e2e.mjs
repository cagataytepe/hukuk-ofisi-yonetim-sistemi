import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const execute = process.argv.includes("--execute");
const env = Object.fromEntries(
  fs.readFileSync(".env.test.local", "utf8")
    .split(/\r?\n/)
    .filter(line => line && !line.trim().startsWith("#") && line.includes("="))
    .map(line => {
      const separator = line.indexOf("=");
      return [
        line.slice(0, separator).trim(),
        line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "")
      ];
    })
);
const configSource = fs.readFileSync("outputs/supabase-config.js", "utf8");
const url = configSource.match(/url:\s*["']([^"']+)/)?.[1];
const publishableKey = configSource.match(/publishableKey:\s*["']([^"']+)/)?.[1];

if (!url || !publishableKey || !env.E2E_USER_EMAIL || !env.E2E_USER_PASSWORD) {
  throw new Error("E2E Supabase bağlantı bilgileri eksik.");
}

const supabase = createClient(url, publishableKey);
const { error: loginError } = await supabase.auth.signInWithPassword({
  email: env.E2E_USER_EMAIL,
  password: env.E2E_USER_PASSWORD
});
if (loginError) throw loginError;

try {
  const [expensesResult, recurringResult, budgetsResult] = await Promise.all([
    supabase.from("office_expenses").select("id,title").ilike("title", "E2E-%").is("deleted_at", null),
    supabase.from("office_expense_recurring_templates").select("id,title").ilike("title", "E2E-%").is("deleted_at", null),
    supabase.from("office_expense_budgets").select("id,year,budget_amount").eq("year", 2199).eq("budget_amount", 5000).is("deleted_at", null)
  ]);
  for (const result of [expensesResult, recurringResult, budgetsResult]) {
    if (result.error) throw result.error;
  }

  const targets = {
    expenses: expensesResult.data || [],
    recurringTemplates: recurringResult.data || [],
    testBudgets: budgetsResult.data || []
  };
  console.log(JSON.stringify({
    mode: execute ? "execute" : "dry-run",
    counts: Object.fromEntries(Object.entries(targets).map(([key, rows]) => [key, rows.length]))
  }, null, 2));

  if (!execute) process.exit(0);

  for (const row of targets.expenses) {
    const { error } = await supabase.rpc("soft_delete_office_expense", { p_id: row.id });
    if (error) throw error;
  }
  for (const row of targets.recurringTemplates) {
    const { error } = await supabase.rpc("soft_delete_office_expense_recurring_template", { p_id: row.id });
    if (error) throw error;
  }
  for (const row of targets.testBudgets) {
    const { error } = await supabase.rpc("soft_delete_office_expense_budget", { p_id: row.id });
    if (error) throw error;
  }

  console.log("E2E Ofis Giderleri kayıtları soft-delete ile temizlendi.");
} finally {
  await supabase.auth.signOut();
}
