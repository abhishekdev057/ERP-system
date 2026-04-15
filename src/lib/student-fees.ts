export const STUDENT_FEE_AUDIT_TYPES = ["PAYMENT", "WAIVER", "CHARGE", "REFUND", "NOTE"] as const;

export type StudentFeeAuditType = (typeof STUDENT_FEE_AUDIT_TYPES)[number];

export type StudentFeeAuditLike = {
    type: StudentFeeAuditType;
    amount: number | null;
};

export function computeStudentFeeSummary(
    totalFees: number | null | undefined,
    audits: StudentFeeAuditLike[]
) {
    const baseFees = Number(totalFees || 0);
    let payments = 0;
    let waivers = 0;
    let charges = 0;
    let refunds = 0;

    for (const audit of audits) {
        const amount = Math.max(0, Number(audit.amount || 0));
        if (!amount) continue;

        if (audit.type === "PAYMENT") payments += amount;
        if (audit.type === "WAIVER") waivers += amount;
        if (audit.type === "CHARGE") charges += amount;
        if (audit.type === "REFUND") refunds += amount;
    }

    const adjustedTotal = baseFees + charges;
    const settled = payments + waivers;
    const pending = Math.max(adjustedTotal - settled + refunds, 0);

    return {
        baseFees,
        adjustedTotal,
        payments,
        waivers,
        charges,
        refunds,
        settled,
        pending,
    };
}

