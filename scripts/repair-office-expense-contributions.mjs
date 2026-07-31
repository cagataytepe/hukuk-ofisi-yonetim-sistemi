import path from "node:path";
import {
  createSupabaseClient,
  loadEnvFile,
  parseArgs,
  writeJsonReport
} from "./files-migration-utils.mjs";

loadEnvFile();
loadEnvFile(path.join(process.cwd(), ".env.local"));

const args = parseArgs();
const execute = args.flags.has("execute");
const reportPath = args.values.report
  || path.join(process.cwd(), "work", execute
    ? "office-expense-contributions-repair-report.json"
    : "office-expense-contributions-dry-run-report.json");
const supabase = createSupabaseClient({ serviceRole: true });

function classifyExpense(row, profileKey) {
  const profileId = row[profileKey] || null;
  if (row.payment_method === "office_account") {
    return { paymentSource: "office_account", contributes: false, profileId: null };
  }
  if (profileId) {
    return { paymentSource: "partner_personal", contributes: true, profileId };
  }
  if (row.payment_method === "cash") {
    return { paymentSource: "office_cash", contributes: false, profileId: null };
  }
  return { paymentSource: "office_account", contributes: false, profileId: null };
}

async function loadRows(table, profileColumn) {
  const { data, error } = await supabase
    .from(table)
    .select(`id,payment_method,${profileColumn},deleted_at`)
    .is("deleted_at", null)
    .limit(10000);
  if (error) throw error;
  return data || [];
}

const [expenses, recurringTemplates] = await Promise.all([
  loadRows("office_expenses", "paid_by_profile_id"),
  loadRows("office_expense_recurring_templates", "default_paid_by_profile_id")
]);

const expensePlans = expenses.map(row => ({
  id: row.id,
  currentPaymentMethod: row.payment_method,
  currentProfileId: row.paid_by_profile_id,
  ...classifyExpense(row, "paid_by_profile_id")
}));
const recurringPlans = recurringTemplates.map(row => ({
  id: row.id,
  currentPaymentMethod: row.payment_method,
  currentProfileId: row.default_paid_by_profile_id,
  ...classifyExpense(row, "default_paid_by_profile_id")
}));

const officeAccountMisclassified = expensePlans.filter(row =>
  row.currentPaymentMethod === "office_account" && row.currentProfileId
);
const recurringOfficeAccountMisclassified = recurringPlans.filter(row =>
  row.currentPaymentMethod === "office_account" && row.currentProfileId
);

const report = {
  generatedAt: new Date().toISOString(),
  mode: execute ? "execute" : "dry-run",
  summary: {
    activeExpenses: expensePlans.length,
    activeRecurringTemplates: recurringPlans.length,
    officeAccountExpensesWithPartner: officeAccountMisclassified.length,
    officeAccountRecurringTemplatesWithPartner: recurringOfficeAccountMisclassified.length,
    partnerPersonalExpenses: expensePlans.filter(row => row.paymentSource === "partner_personal").length,
    partnerPersonalRecurringTemplates: recurringPlans.filter(row => row.paymentSource === "partner_personal").length,
    officeCashExpenses: expensePlans.filter(row => row.paymentSource === "office_cash").length,
    officeCashRecurringTemplates: recurringPlans.filter(row => row.paymentSource === "office_cash").length
  },
  affectedOfficeAccountExpenseIds: officeAccountMisclassified.map(row => row.id),
  affectedOfficeAccountRecurringTemplateIds: recurringOfficeAccountMisclassified.map(row => row.id)
};

writeJsonReport(reportPath, report);
console.log(JSON.stringify({ reportPath, ...report.summary }, null, 2));

if (!execute) {
  console.log("Dry-run tamamlandi. Veri degistirilmedi. Gercek onarim icin --execute zorunludur.");
} else {
  for (const plan of expensePlans) {
    const { error } = await supabase
      .from("office_expenses")
      .update({
        payment_source: plan.paymentSource,
        contributes_to_partner_share: plan.contributes,
        paid_by_profile_id: plan.profileId
      })
      .eq("id", plan.id)
      .is("deleted_at", null);
    if (error) throw error;
  }

  for (const plan of recurringPlans) {
    const { error } = await supabase
      .from("office_expense_recurring_templates")
      .update({
        payment_source: plan.paymentSource,
        contributes_to_partner_share: plan.contributes,
        default_paid_by_profile_id: plan.profileId
      })
      .eq("id", plan.id)
      .is("deleted_at", null);
    if (error) throw error;
  }

  console.log("Ofis gideri odeme kaynaklari ve ortak katkisi alanlari guvenli kurala gore onarildi.");
}
