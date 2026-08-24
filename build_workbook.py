"""Generate the eToro copy-suitability calculator workbook.

Regenerate after any change to the ClientRiskProfileConfiguration tables:
    python build_workbook.py

Scoring data mirrors the live Cosmos documents exported to config-prod/ — CySEC-24,
FCA-15, ASIC-9, ASICGAML-15 and FSRA-10. All data in this script is product
configuration; no credentials and no client data are involved.
"""

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

OUT = "eToro-suitability-test-calculator.xlsx"

INK = "1F2A37"
ACCENT = "0F5C4A"
HEAD_FILL = PatternFill("solid", fgColor="0F5C4A")
INPUT_FILL = PatternFill("solid", fgColor="FFF6D6")
CALC_FILL = PatternFill("solid", fgColor="F2F4F7")
RESULT_FILL = PatternFill("solid", fgColor="DCEBE6")
WARN_FILL = PatternFill("solid", fgColor="FDE7E4")

H1 = Font(bold=True, size=16, color=INK)
H2 = Font(bold=True, size=12, color=ACCENT)
HEAD = Font(bold=True, size=10, color="FFFFFF")
BOLD = Font(bold=True, size=10, color=INK)
BODY = Font(size=10, color=INK)
SMALL = Font(size=9, color="6B7280")
MONO = Font(name="Menlo", size=10, color=INK)
BIG = Font(bold=True, size=14, color=ACCENT)
ALERT = Font(bold=True, size=9, color="B42318")

THIN = Side(style="thin", color="D5DBE0")
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
WRAP = Alignment(wrap_text=True, vertical="top")
CENTER = Alignment(horizontal="center", vertical="center")

# --- scoring data, verbatim from the Cosmos config -------------------------
EXP = ["Never traded", "0-10 times", "10-20 times", "Above 20 times"]
EXP_CFD = EXP + ["10-40 times", "Above 40 times"]
VOL = ["Never", "$1 - $500", "$500 - $2,000", "Above $2,000"]
BANDS = ["Up to $10K", "$10K - $50K", "$50K - $200K",
         "$200K - $500K", "$500K - $1M", "$1M - $5M"]
PLAN = ["Up to $20K", "$20K - $50K", "$50K - $200K",
        "$200K - $500K", "$500K - $1M", "Above $1M"]

LEVEL_WEIGHT = {"Minimal": 0, "Low": 1, "Medium": 2, "MediumHigh": 3, "High": 4}


def lv(name):
    """Expand a risk-level name into (name, ordinal weight)."""
    return (name, LEVEL_WEIGHT[name])


# (config key, legacy question id, question text, [(answer, level, weight)])
SCORING = [
    ("Equities", "Q33", "How often have you traded stocks?",
     [(EXP[0], *lv("Medium")), (EXP[1], *lv("Medium")),
      (EXP[2], *lv("MediumHigh")), (EXP[3], *lv("High"))]),
    ("Crypto", "Q34", "How often have you traded crypto?",
     [(EXP[0], *lv("Medium")), (EXP[1], *lv("MediumHigh")),
      (EXP[2], *lv("High")), (EXP[3], *lv("High"))]),
    ("LeveragedCfd", "Q35", "How often have you traded leveraged CFDs?",
     [(EXP_CFD[0], *lv("Medium")), (EXP_CFD[1], *lv("MediumHigh")),
      (EXP_CFD[2], *lv("High")), (EXP_CFD[3], *lv("High")),
      (EXP_CFD[4], *lv("High")), (EXP_CFD[5], *lv("High"))]),
    ("EquitiesInvestedAmount", "Q47", "How much have you invested in stocks?",
     [(VOL[0], *lv("Medium")), (VOL[1], *lv("Medium")),
      (VOL[2], *lv("Medium")), (VOL[3], *lv("Medium"))]),
    ("CryptoInvestedAmount", "Q48", "How much have you invested in crypto?",
     [(VOL[0], *lv("Medium")), (VOL[1], *lv("Medium")),
      (VOL[2], *lv("High")), (VOL[3], *lv("High"))]),
    ("LeveragedCfdInvestedAmount", "Q45", "How much have you invested in leveraged CFDs?",
     [(VOL[0], *lv("Medium")), (VOL[1], *lv("MediumHigh")),
      (VOL[2], *lv("High")), (VOL[3], *lv("High"))]),
    ("TradingKnowledge", "Q3", "What relevant financial knowledge do you have?",
     [("Professional certificate / work experience", *lv("High")),
      ("University degree in finance", *lv("High")),
      ("Trading courses", *lv("MediumHigh")),
      ("No financial knowledge", *lv("Medium"))]),
    ("TradingStrategy", "Q5", "How long do you typically hold a position?",
     [("A few seconds up to 24 hours", *lv("High")),
      ("A few weeks up to several months", *lv("MediumHigh")),
      ("More than several months / years", *lv("Medium"))]),
    # The copy funnel offers all eight answers to everyone, but only CySEC-24 scores
    # answers 900-902 and no config scores 903. Levels below are CySEC-24's; the
    # regulation-aware override further down applies the fallback for the rest.
    ("TradingPurpose", "Q8", "What is your primary purpose for trading?",
     [("Short-term returns", *lv("High")),
      ("Additional revenues", *lv("MediumHigh")),
      ("Future planning", *lv("Medium")),
      ("Saving for a home", *lv("Medium")),
      ("Converting crypto to fiat", *lv("High")),
      ("Trading", *lv("Medium")),
      ("Investments", *lv("Low")),
      ("Crypto trading and/or conversion", *lv("Medium"))]),
    ("RiskAppetite", "Q9", "What gain and loss are you comfortable with?",
     [("5% / -3%", *lv("Low")), ("10% / -6%", *lv("Medium")),
      ("20% / -12%", *lv("MediumHigh")), ("40% / -24%", *lv("High")),
      ("80% / -48%", *lv("High"))]),
    ("IncomeSource", "Q15", "What is your main source of income?",
     [("Salary", *lv("High")), ("Employment", *lv("High")),
      ("Investments", *lv("High")), ("Savings", *lv("High")),
      ("Business activities", *lv("High")), ("Crypto-related gains", *lv("High")),
      ("Inheritance", *lv("MediumHigh")),
      ("Family financial support", *lv("Medium")), ("Other", *lv("Medium")),
      ("Pension", *lv("Low")), ("Social security", *lv("Low")),
      ("Severance", *lv("Low"))]),
]

# Component 9, CySEC only, added in CySEC-20. Five single-select MiCA crypto-knowledge
# questions; exactly one answer per question is the informed one and scores High.
MICA = [
    ("MiCACryptoAssessmentHighVolatility", "Crypto markets are highly volatile. This means:",
     [("It can lead to significant gains or losses", *lv("High")),
      ("Crypto makes a stable investment", *lv("Low")),
      ("Crypto guarantees long-term profits", *lv("Low"))]),
    ("MiCACryptoAssessmentCyberRisks", "Which of these best protects you from cyber risk?",
     [("Enabling two-factor authentication", *lv("High")),
      ("Using the same password everywhere", *lv("Low")),
      ("Sharing private keys with friends", *lv("Low"))]),
    ("MiCACryptoAssessmentRecoverLoss", "If you lose crypto assets, the law:",
     [("Does not cover the loss", *lv("High")),
      ("Covers the recovery", *lv("Low")),
      ("Lets you claim from consumer services", *lv("Low"))]),
    ("MiCACryptoAssessmentInvestingRisks", "The risk of investing in crypto is:",
     [("You risk losing your whole investment", *lv("High")),
      ("Minimal", *lv("Low")),
      ("Low", *lv("Low"))]),
    ("MiCACryptoAssessmentPrivateKey", "A private key is:",
     [("A secret code", *lv("High")),
      ("A shared password", *lv("Low")),
      ("A public identifier", *lv("Low"))]),
]
MICA_DEFAULT_LEVEL = 1  # component DefaultRiskLevel is Low, applied per unanswered question

HARD_BLOCK_INPUTS = [
    ("AnnualIncome", "Q10", "What is your net annual income?"),
    ("LiquidAssets", "Q11", "What are your total cash and liquid assets?"),
]

# --- what actually differs between the five live configs -------------------
# Three things: whether component 9 sits in Factor B, which answers question 8
# scores, and the SuitabilityBlock conditions. Everything else is identical.

# Q8 answers every config scores, and the three only CySEC-24 adds. The copy funnel
# offers all eight under every regulation, so a non-CySEC user can pick one of the
# three; SuitabilityRiskLevelCalculator.GetQuestionAnswerRiskLevel then finds no
# matching entry and returns DefaultRiskLevel.
PURPOSES_ALL_CONFIGS = ["Short-term returns", "Additional revenues",
                        "Future planning", "Saving for a home"]
CYSEC_ONLY_SCORED_PURPOSES = ["Converting crypto to fiat", "Trading", "Investments"]
# No config scores this one, so it is the default under every regulation.
NEVER_SCORED_PURPOSE = "Crypto trading and/or conversion"
DEFAULT_LEVEL = 2  # Suitability.RiskLevel.DefaultRiskLevel is Medium in all five configs

# SuitabilityBlock.Checks[0].QuestionAnswerChecks, verbatim. Condition is "All", so
# every row has to be true before the user is blocked. The income and liquid-asset
# rows list the three lowest bands, which is what UpTo10K / Between10KAnd50K /
# Between50KAnd200K expand to.
BLOCK_COMMON = [
    ("RiskAppetite", ["5% / -3%"]),
    ("TradingPurpose", ["Future planning", "Saving for a home"]),
    ("AnnualIncome", BANDS[:3]),
    ("LiquidAssets", BANDS[:3]),
]
# ASIC GAML widens the risk-appetite trigger, narrows the purpose trigger and adds a
# fifth condition on source of income.
BLOCK_GAML = [
    ("RiskAppetite", ["5% / -3%", "10% / -6%"]),
    ("TradingPurpose", ["Future planning"]),
    ("AnnualIncome", BANDS[:3]),
    ("LiquidAssets", BANDS[:3]),
    ("IncomeSource", ["Pension"]),
]

# FCA-15 is the only config that sets the check-level DefaultResult to Blocked, which
# reads like a fail-closed rule. It is not one: suitability goes through
# BlockCalculator.Calculate, which passes the *block*-level DefaultResult down and
# returns it on fall-through. Check.DefaultResult is read in exactly one place,
# CheckCalculator.ApplyWithResult's nested-check branch, and the suitability block has
# NestedChecks: []. So the field never runs and FCA blocks exactly like CySEC.
FCA_DEAD_DEFAULT = (
    "FCA-15 is the only config that sets this check's DefaultResult to Blocked. It has "
    "no effect. Suitability calls BlockCalculator.Calculate, which hands the block-level "
    "DefaultResult (NotBlocked, same in all five configs) to every check and returns it "
    "when no check applies; Check.DefaultResult is only ever read for nested checks and "
    "this block has none. FCA therefore fails open on an unanswered question, exactly "
    "like the other four.")

# sheet name, config document, component 9 in Factor B, Q8 answers scored,
# hard-block conditions, the config's check-level DefaultResult
REGS = [
    dict(sheet="CySEC v24", name="CySEC", doc="CySEC-24", mica=True,
         purposes=PURPOSES_ALL_CONFIGS + CYSEC_ONLY_SCORED_PURPOSES,
         block=BLOCK_COMMON, default_result="NotBlocked", note=None),
    dict(sheet="FCA v15", name="FCA", doc="FCA-15", mica=False,
         purposes=PURPOSES_ALL_CONFIGS,
         block=BLOCK_COMMON, default_result="Blocked", note=FCA_DEAD_DEFAULT),
    dict(sheet="ASIC v9", name="ASIC", doc="ASIC-9", mica=False,
         purposes=PURPOSES_ALL_CONFIGS,
         block=BLOCK_COMMON, default_result="not set", note=None),
    dict(sheet="ASIC GAML v15", name="ASIC GAML", doc="ASICGAML-15", mica=False,
         purposes=PURPOSES_ALL_CONFIGS,
         block=BLOCK_GAML, default_result="NotBlocked", note=None),
    dict(sheet="FSRA v10", name="FSRA", doc="FSRA-10", mica=False,
         purposes=PURPOSES_ALL_CONFIGS,
         block=BLOCK_COMMON, default_result="not set", note=None),
]

# The sheet opens on a plausible mid-range profile rather than the first option of
# every dropdown, which would combine "never traded" with a professional certificate.
DEFAULTS = {
    "Equities": "0-10 times",
    "Crypto": "Never traded",
    "LeveragedCfd": "Never traded",
    "EquitiesInvestedAmount": "$1 - $500",
    "CryptoInvestedAmount": "Never",
    "LeveragedCfdInvestedAmount": "Never",
    "TradingKnowledge": "No financial knowledge",
    "TradingStrategy": "A few weeks up to several months",
    "TradingPurpose": "Additional revenues",
    "RiskAppetite": "20% / -12%",
    "IncomeSource": "Salary",
    "AnnualIncome": "$50K - $200K",
    "LiquidAssets": "$50K - $200K",
}

# Q23 TradingKnowledgeAssessment. Answer IDs and statement text from the question-bank
# snapshot, translation keys tradingAssessment.Q1C-Q6C. A positive weight marks a
# factually TRUE statement, a negative weight a FALSE one. The final flag records
# whether the live question catalogue still offers the statement: 212 is scored by
# every config but is no longer in OptionQuestions.json, so it can never be ticked and
# therefore always contributes -(-2) = +2.
KA = [
    (142, "NewerLeverage", 2,
     "I deposit and invest $1,000 to open a position with $20,000 (using leverage of 20x). "
     "If the market moves 5% against my position, I'll lose my investment", True),
    (144, "NewerMarginCall", 2,
     "If the total equity (i.e. the combined value of positions and available cash) in my "
     'account falls below the required margin, a "margin call" will liquidate my positions',
     True),
    (143, "NewerCfd", -2,
     "If the price of Google's stock rises on NASDAQ, the price of my Google contract for "
     "difference (CFD) will go down", True),
    (145, "NewerStopLossTrigger", -2,
     "My open positions will remain open even when a stop loss is triggered", True),
    (146, "NewerStopLossGapThrough", -2,
     "If the market gaps through my stop loss, my position will close at the exact stop "
     "loss level", True),
    (212, "NewerCfdTrs", -2,
     "I will be able to sell my OTC complex products (CFD, TRS) outside of eToro platform",
     False),
]
RETIRED_KA = [name for _, name, _, _, offered in KA if not offered]
# The sheet opens on a partially-informed user: one true statement ticked, one false one
# ticked. Opening with nothing ticked would trip the fallback and hide the scoring.
KA_DEFAULT_TICKED = {"NewerLeverage", "NewerCfd"}
KA_BANDS = [(-100, 1, "Low"), (-6, 2, "Medium"), (2, 3, "MediumHigh"), (6, 4, "High")]

LEVEL_ROWS = [(0, "Minimal", 3), (1, "Low", 3), (2, "Medium", 6),
              (3, "MediumHigh", 8), (4, "High", 10)]

# midpoints used by the monitoring sheet (answers.data.ts averageAmount)
BAND_MID = [5000, 30000, 125000, 350000, 750000, 3000000]
PLAN_MID = [10000, 35000, 125000, 350000, 750000, 1000000]

wb = Workbook()


def style_header(ws, row, cols):
    for c in range(1, cols + 1):
        cell = ws.cell(row=row, column=c)
        cell.fill = HEAD_FILL
        cell.font = HEAD
        cell.border = BOX
        cell.alignment = Alignment(vertical="center", wrap_text=True)
    ws.row_dimensions[row].height = 22


def widths(ws, spec):
    for col, w in spec.items():
        ws.column_dimensions[col].width = w


def boxed(ws, row, cols):
    for c in range(1, cols + 1):
        ws.cell(row=row, column=c).border = BOX


# ===========================================================================
# Scoring — the lookup engine
# ===========================================================================
sc = wb.active
sc.title = "Scoring"
sc["A1"] = "Scoring tables"
sc["A1"].font = H1
sc["A2"] = ("Verbatim from the live ClientRiskProfileConfiguration documents CySEC-24, FCA-15, "
            "ASIC-9, ASIC GAML-15 and FSRA-10. Every calculator tab looks up against column A.")
sc["A2"].font = SMALL
sc.merge_cells("A2:F2")

hdr = 4
for i, v in enumerate(["Lookup key", "Question", "Answer", "Risk level", "Weight", "Notes"], start=1):
    sc.cell(row=hdr, column=i, value=v)
style_header(sc, hdr, 6)

r = hdr + 1
KEY_START = r
for key, qid, qtext, answers in SCORING:
    for ans, level, weight in answers:
        sc.cell(row=r, column=1, value=f"{key}|{ans}").font = MONO
        sc.cell(row=r, column=2, value=f"{qid} {key}").font = BODY
        sc.cell(row=r, column=3, value=ans).font = BODY
        sc.cell(row=r, column=4, value=level).font = BODY
        sc.cell(row=r, column=5, value=weight).font = BOLD
        sc.cell(row=r, column=5).alignment = CENTER
        boxed(sc, r, 6)
        r += 1

for key, qid, qtext in HARD_BLOCK_INPUTS:
    for rank, band in enumerate(BANDS, start=1):
        sc.cell(row=r, column=1, value=f"{key}|{band}").font = MONO
        sc.cell(row=r, column=2, value=f"{qid} {key}").font = BODY
        sc.cell(row=r, column=3, value=band).font = BODY
        sc.cell(row=r, column=4, value="not scored").font = SMALL
        sc.cell(row=r, column=5, value=rank).font = BOLD
        sc.cell(row=r, column=5).alignment = CENTER
        sc.cell(row=r, column=6, value="band rank; hard block needs rank <= 3").font = SMALL
        boxed(sc, r, 6)
        r += 1

for key, qtext, answers in MICA:
    for ans, level, weight in answers:
        sc.cell(row=r, column=1, value=f"{key}|{ans}").font = MONO
        sc.cell(row=r, column=2, value=f"C9 {key}").font = BODY
        sc.cell(row=r, column=3, value=ans).font = BODY
        sc.cell(row=r, column=4, value=level).font = BODY
        sc.cell(row=r, column=5, value=weight).font = BOLD
        sc.cell(row=r, column=5).alignment = CENTER
        sc.cell(row=r, column=6, value="CySEC only, from CySEC-20").font = SMALL
        boxed(sc, r, 6)
        r += 1
KEY_END = r - 1
LOOKUP = f"Scoring!$A${KEY_START}:$E${KEY_END}"

r += 2
sc.cell(row=r, column=1, value="Risk level weight -> name and authorised risk score").font = H2
r += 1
for i, v in enumerate(["Weight", "Risk level", "AuthorizedRiskScore"], start=1):
    sc.cell(row=r, column=i, value=v)
style_header(sc, r, 3)
r += 1
LVL_START = r
for w, name, score in LEVEL_ROWS:
    sc.cell(row=r, column=1, value=w).font = BOLD
    sc.cell(row=r, column=2, value=name).font = BODY
    sc.cell(row=r, column=3, value=score).font = BOLD
    for c in range(1, 4):
        sc.cell(row=r, column=c).border = BOX
        sc.cell(row=r, column=c).alignment = CENTER
    r += 1
LVL_END = r - 1
LVL = f"Scoring!$A${LVL_START}:$C${LVL_END}"

r += 2
sc.cell(row=r, column=1, value="Component 8 - knowledge assessment answer scores").font = H2
r += 1
sc.cell(row=r, column=1, value=("Six true/false statements presented as one multi-select. "
                                "A positive weight marks a statement that is factually true.")
        ).font = SMALL
sc.merge_cells(start_row=r, start_column=1, end_row=r, end_column=6)
r += 1
for i, v in enumerate(["Answer (config name)", "Answer ID", "Weight", "Statement is",
                       "Statement"], start=1):
    sc.cell(row=r, column=i, value=v)
style_header(sc, r, 6)
r += 1
for answer_id, name, score, statement, offered in KA:
    sc.cell(row=r, column=1, value=name).font = MONO
    sc.cell(row=r, column=2, value=answer_id).font = BODY
    sc.cell(row=r, column=3, value=score).font = BOLD
    sc.cell(row=r, column=4, value="TRUE" if score > 0 else "FALSE").font = BODY
    if not offered:
        statement += "    [RETIRED - scored but no longer asked, so always contributes +2]"
    sc.cell(row=r, column=5, value=statement).font = BODY
    sc.merge_cells(start_row=r, start_column=5, end_row=r, end_column=6)
    sc.cell(row=r, column=5).alignment = WRAP
    for c in (2, 3, 4):
        sc.cell(row=r, column=c).alignment = CENTER
    boxed(sc, r, 6)
    sc.row_dimensions[r].height = max(16, 12 * (len(statement) // 60 + 1))
    r += 1

r += 1
sc.cell(row=r, column=1, value="Total score -> risk level (LOOKUP needs ascending thresholds)").font = H2
r += 1
for i, v in enumerate(["Min total score", "Weight", "Risk level"], start=1):
    sc.cell(row=r, column=i, value=v)
style_header(sc, r, 3)
r += 1
KB_START = r
for thr, w, name in KA_BANDS:
    sc.cell(row=r, column=1, value=thr).font = BOLD
    sc.cell(row=r, column=2, value=w).font = BODY
    sc.cell(row=r, column=3, value=name).font = BODY
    for c in range(1, 4):
        sc.cell(row=r, column=c).border = BOX
        sc.cell(row=r, column=c).alignment = CENTER
    r += 1
KB_END = r - 1

r += 1
sc.cell(row=r, column=1, value=(
    "The config gives a weight per answer and never says how an answer the user did NOT tick is "
    "treated. The service does: WeightQuestionAnswerCalculator.GetScoreByAnswerIds adds the "
    "weight for a ticked answer and subtracts it for an unticked one, so the total runs -12 to "
    "+12 and every band is reachable. Confirmed against the calculator's own 14 test vectors. "
    "If the user ticks nothing the group is skipped and component 8 falls back to Medium."))
sc.cell(row=r, column=1).font = SMALL
sc.cell(row=r, column=1).alignment = WRAP
sc.merge_cells(start_row=r, start_column=1, end_row=r + 2, end_column=6)
r += 2

r += 3
sc.cell(row=r, column=1, value="Financial band midpoints (ongoing monitoring)").font = H2
r += 1
for i, v in enumerate(["Band", "Income / assets midpoint",
                       "Planned-investment band", "Planned midpoint"], start=1):
    sc.cell(row=r, column=i, value=v)
style_header(sc, r, 4)
r += 1
MID_START = r
for i, band in enumerate(BANDS):
    sc.cell(row=r, column=1, value=band).font = BODY
    sc.cell(row=r, column=2, value=BAND_MID[i]).number_format = "#,##0"
    sc.cell(row=r, column=3, value=PLAN[i]).font = BODY
    sc.cell(row=r, column=4, value=PLAN_MID[i]).number_format = "#,##0"
    boxed(sc, r, 4)
    r += 1
MID_END = r - 1
MID_INC = f"Scoring!$A${MID_START}:$B${MID_END}"
MID_PLAN = f"Scoring!$C${MID_START}:$D${MID_END}"

widths(sc, {"A": 40, "B": 30, "C": 34, "D": 16, "E": 12, "F": 44})
sc.freeze_panes = "A5"

# ===========================================================================
# Lists — dropdown sources
# ===========================================================================
ls = wb.create_sheet("Lists")
ls["A1"] = "Dropdown sources. Referenced by data validation on the input sheets."
ls["A1"].font = SMALL

list_cols = {}
col = 1
for key, qid, qtext, answers in SCORING:
    letter = get_column_letter(col)
    ls.cell(row=2, column=col, value=key).font = BOLD
    for i, (ans, _lvl, _w) in enumerate(answers, start=3):
        ls.cell(row=i, column=col, value=ans).font = BODY
    list_cols[key] = f"Lists!${letter}$3:${letter}${2 + len(answers)}"
    col += 1

for key, qid, qtext in HARD_BLOCK_INPUTS:
    letter = get_column_letter(col)
    ls.cell(row=2, column=col, value=key).font = BOLD
    for i, band in enumerate(BANDS, start=3):
        ls.cell(row=i, column=col, value=band).font = BODY
    list_cols[key] = f"Lists!${letter}$3:${letter}${2 + len(BANDS)}"
    col += 1

letter = get_column_letter(col)
ls.cell(row=2, column=col, value="YesNo").font = BOLD
ls.cell(row=3, column=col, value="Yes")
ls.cell(row=4, column=col, value="No")
list_cols["YesNo"] = f"Lists!${letter}$3:${letter}$4"
col += 1

letter = get_column_letter(col)
ls.cell(row=2, column=col, value="PlannedInvestment").font = BOLD
for i, band in enumerate(PLAN, start=3):
    ls.cell(row=i, column=col, value=band).font = BODY
list_cols["PlannedInvestment"] = f"Lists!${letter}$3:${letter}${2 + len(PLAN)}"
col += 1

for key, qtext, answers in MICA:
    letter = get_column_letter(col)
    ls.cell(row=2, column=col, value=key).font = BOLD
    for i, (ans, _lvl, _w) in enumerate(answers, start=3):
        ls.cell(row=i, column=col, value=ans).font = BODY
    list_cols[key] = f"Lists!${letter}$3:${letter}${2 + len(answers)}"
    col += 1

for c in range(1, col + 1):
    ls.column_dimensions[get_column_letter(c)].width = 32
ls.sheet_state = "hidden"

# ===========================================================================
# Calculator - one sheet per regulation
# ===========================================================================
comp_of = {
    "Equities": "Component 1", "Crypto": "Component 1", "LeveragedCfd": "Component 1",
    "EquitiesInvestedAmount": "Component 2", "CryptoInvestedAmount": "Component 2",
    "LeveragedCfdInvestedAmount": "Component 2", "TradingKnowledge": "Component 3",
    "TradingStrategy": "Component 4", "TradingPurpose": "Component 5",
    "RiskAppetite": "Component 6", "IncomeSource": "Component 7",
}
BLOCK_LABEL = {
    "RiskAppetite": "Q9 gain/loss comfort is",
    "TradingPurpose": "Q8 purpose of trading is",
    "AnnualIncome": "Q10 net annual income is",
    "LiquidAssets": "Q11 cash and liquid assets are",
    "IncomeSource": "Q15 source of income is",
}
ALL_PURPOSES = [a for a, _lvl, _w in
                next(ans for k, _q, _t, ans in SCORING if k == "TradingPurpose")]


def build_calculator(reg):
    """Emit one calculator sheet modelling a single regulation's live configuration."""
    ca = wb.create_sheet(reg["sheet"])
    ca["A1"] = f"Suitability calculator - {reg['name']}"
    ca["A1"].font = H1
    ca["A2"] = (f"Answer the yellow cells; everything else is calculated. This sheet models "
                f"{reg['doc']}, the live configuration for {reg['name']}. Each regulation gets "
                f"its own sheet because the scored answers and the hard block differ.")
    ca["A2"].font = SMALL
    ca.merge_cells("A2:F2")
    widths(ca, {"A": 8, "B": 46, "C": 40, "D": 16, "E": 10, "F": 34})

    row = 4
    step = 0

    def heading(text):
        nonlocal row, step
        step += 1
        ca.cell(row=row, column=1, value=f"STEP {step} - {text}").font = H2
        row += 1

    def paragraph(text, lines=1):
        nonlocal row
        ca.cell(row=row, column=2, value=text).font = SMALL
        ca.cell(row=row, column=2).alignment = WRAP
        ca.merge_cells(start_row=row, start_column=2,
                       end_row=row + lines - 1, end_column=6)
        row += lines

    # ---- questions --------------------------------------------------------
    heading("answer the questions")
    for i, v in enumerate(["Q", "Question", "Your answer", "Risk level", "Weight", "Feeds"],
                          start=1):
        ca.cell(row=row, column=i, value=v)
    style_header(ca, row, 6)
    row += 1

    q_rows = {}
    unscored = [a for a in ALL_PURPOSES if a not in reg["purposes"]]

    for key, qid, qtext, answers in SCORING:
        ca.cell(row=row, column=1, value=qid).font = SMALL
        ca.cell(row=row, column=2, value=qtext).font = BODY
        cell = ca.cell(row=row, column=3, value=DEFAULTS[key])
        cell.font = BOLD
        cell.fill = INPUT_FILL
        lvl = f'IFERROR(VLOOKUP("{key}|"&C{row},{LOOKUP},4,FALSE),"?")'
        wgt = f'IFERROR(VLOOKUP("{key}|"&C{row},{LOOKUP},5,FALSE),"")'
        if key == "TradingPurpose" and unscored:
            # The funnel offers all eight answers under every regulation. One this config
            # does not list falls back to DefaultRiskLevel via
            # SuitabilityRiskLevelCalculator.GetQuestionAnswerRiskLevel - not to the level
            # CySEC assigns it.
            miss = "OR(" + ",".join(f'C{row}="{a}"' for a in unscored) + ")"
            lvl = f'IF({miss},"Medium (unscored - default)",{lvl})'
            wgt = f"IF({miss},{DEFAULT_LEVEL},{wgt})"
        ca.cell(row=row, column=4, value="=" + lvl).font = BODY
        ca.cell(row=row, column=5, value="=" + wgt).font = BOLD
        ca.cell(row=row, column=5).alignment = CENTER
        ca.cell(row=row, column=6, value=comp_of[key]).font = SMALL
        boxed(ca, row, 6)
        dv = DataValidation(type="list", formula1=list_cols[key], allow_blank=False)
        ca.add_data_validation(dv)
        dv.add(cell)
        q_rows[key] = row
        row += 1

    for key, qid, qtext in HARD_BLOCK_INPUTS:
        ca.cell(row=row, column=1, value=qid).font = SMALL
        ca.cell(row=row, column=2, value=qtext).font = BODY
        cell = ca.cell(row=row, column=3, value=DEFAULTS[key])
        cell.font = BOLD
        cell.fill = INPUT_FILL
        ca.cell(row=row, column=4, value="not scored").font = SMALL
        ca.cell(row=row, column=5,
                value=f'=IFERROR(VLOOKUP("{key}|"&C{row},{LOOKUP},5,FALSE),"")').font = BOLD
        ca.cell(row=row, column=5).alignment = CENTER
        ca.cell(row=row, column=6, value="Hard block only").font = SMALL
        boxed(ca, row, 6)
        dv = DataValidation(type="list", formula1=list_cols[key], allow_blank=False)
        ca.add_data_validation(dv)
        dv.add(cell)
        q_rows[key] = row
        row += 1

    if unscored:
        row += 1
        paragraph(
            f"{reg['doc']} scores {len(reg['purposes'])} of the {len(ALL_PURPOSES)} answers "
            f"the funnel offers for Q8. The {len(unscored)} it omits - "
            + "; ".join(unscored) +
            " - are still selectable in the funnel here, and each one silently takes the "
            "default risk level, Medium. Pick one and the risk-level cell says so.", lines=2)

    # ---- Q23 knowledge assessment -----------------------------------------
    row += 1
    heading("Q23 complex-products knowledge assessment")
    paragraph(
        "Six true/false statements shown as one multi-select. Mark Yes for each statement you "
        "would tick. Two are factually true and carry +2 - the analyzer enum annotates exactly "
        "those two as the correct answers - and four are false and carry -2.")
    row += 1
    paragraph(
        "Every statement is judged, whether or not it is ticked. WeightQuestionAnswerCalculator."
        "GetScoreByAnswerIds walks the whole group and does score += weight for a ticked answer, "
        "score -= weight for an unticked one, so ticking a true statement or leaving a false one "
        "alone both earn +2 and the opposite costs -2. The total runs -12 to +12 and no statement "
        "can contribute 0.    The one exception: tick nothing and the group is skipped entirely, "
        "so component 8 falls back to the default risk level, Medium. Q23 is "
        "IsRequiredForCopy=false, so a user can leave it alone and still copy.", lines=3)

    for i, v in enumerate(["ID", "Statement", "Selected?", "Weight", "Contribution",
                           "Answer (config name)"], start=1):
        ca.cell(row=row, column=i, value=v)
    style_header(ca, row, 6)
    row += 1
    ka_first = row
    for answer_id, name, score, statement, offered in KA:
        ca.cell(row=row, column=1, value=answer_id).font = SMALL
        ca.cell(row=row, column=1).alignment = CENTER
        label = statement if offered else statement + "    [RETIRED - no longer asked]"
        ca.cell(row=row, column=2, value=label).font = BODY
        ca.cell(row=row, column=2).alignment = WRAP
        cell = ca.cell(row=row, column=3, value="Yes" if name in KA_DEFAULT_TICKED else "No")
        cell.font = ALERT if not offered else BOLD
        cell.fill = INPUT_FILL
        ca.cell(row=row, column=4, value=f"{score:+d}").font = SMALL
        ca.cell(row=row, column=4).alignment = CENTER
        ca.cell(row=row, column=5, value=f'=IF(C{row}="Yes",{score},{-score})').font = BOLD
        ca.cell(row=row, column=5).alignment = CENTER
        ca.cell(row=row, column=6, value=name).font = MONO
        boxed(ca, row, 6)
        ca.row_dimensions[row].height = max(16, 13 * (len(label) // 52 + 1))
        dv = DataValidation(type="list", formula1=list_cols["YesNo"], allow_blank=False)
        ca.add_data_validation(dv)
        dv.add(cell)
        row += 1
    ka_last = row - 1
    ca.cell(row=row, column=2, value="Total assessment score").font = BOLD
    ca.cell(row=row, column=5, value=f"=SUM(E{ka_first}:E{ka_last})").font = BOLD
    ca.cell(row=row, column=5).alignment = CENTER
    ca.cell(row=row, column=5).fill = CALC_FILL
    ca.cell(row=row, column=6, value=(
        f'=IF(COUNTIF($C${ka_first}:$C${ka_last},"Yes")=0,'
        f'"nothing ticked - score not applied, component 8 falls back to Medium",'
        f'"reachable in production: -8 to +12")')).font = SMALL
    boxed(ca, row, 6)
    ka_total = row
    ka_ticked = f'COUNTIF($C${ka_first}:$C${ka_last},"Yes")'
    row += 1

    # The retired statement stays toggleable so the engine's own test vectors, written
    # against the full six-statement group, still reproduce on this sheet.
    retired_rows = [ka_first + i for i, (*_, offered) in enumerate(KA) if not offered]
    paragraph(
        "The last statement is scored by every live configuration but is no longer in the "
        "question catalogue, so no real user can tick it. It therefore contributes a constant "
        "+2 to everyone, which is why the reachable range is -8 to +12 rather than -12 to +12 "
        "and why High needs 4 of the 5 answerable statements rather than 5 of 6. It changes no "
        "band outcome - every threshold is 4 apart and the offset is 2. Leave it on No to model "
        "production; it stays editable only so the analyzer's own test vectors reproduce here.",
        lines=2)
    if retired_rows:
        ticked_retired = "+".join(f'--(C{rr}="Yes")' for rr in retired_rows)
        ca.cell(row=row, column=2, value=(
            f'=IF({ticked_retired}>0,'
            f'"Warning: a retired statement is ticked. No production user can do that - '
            f'the score below is reachable only in the analyzer unit tests.","")')).font = ALERT
        ca.merge_cells(start_row=row, start_column=2, end_row=row, end_column=6)
        row += 1
    row += 1

    # ---- component 9, CySEC only ------------------------------------------
    mica_rows = {}
    if reg["mica"]:
        heading("MiCA crypto knowledge (component 9)")
        paragraph(
            "Component 9 entered Factor B in CySEC-20 and exists under no other regulation. "
            "Each question scores High for the one informed answer and Low for the two wrong "
            "ones; the five are averaged and rounded down. An unanswered question falls back "
            "to the component default, Low.", lines=2)
        for i, v in enumerate(["", "Question", "Answer", "Risk level", "Weight", "Config name"],
                              start=1):
            ca.cell(row=row, column=i, value=v)
        style_header(ca, row, 6)
        row += 1
        for key, qtext, answers in MICA:
            ca.cell(row=row, column=2, value=qtext).font = BODY
            ca.cell(row=row, column=2).alignment = WRAP
            cell = ca.cell(row=row, column=3, value=answers[0][0])
            cell.font = BOLD
            cell.fill = INPUT_FILL
            ca.cell(row=row, column=4,
                    value=f'=IFERROR(VLOOKUP("{key}|"&C{row},{LOOKUP},4,FALSE),"?")').font = BODY
            ca.cell(row=row, column=5,
                    value=f'=IFERROR(VLOOKUP("{key}|"&C{row},{LOOKUP},5,FALSE),'
                          f"{MICA_DEFAULT_LEVEL})").font = BOLD
            ca.cell(row=row, column=5).alignment = CENTER
            ca.cell(row=row, column=6, value=key).font = MONO
            boxed(ca, row, 6)
            dv = DataValidation(type="list", formula1=list_cols[key], allow_blank=False)
            ca.add_data_validation(dv)
            dv.add(cell)
            mica_rows[key] = row
            row += 1
        row += 1

    # ---- components -------------------------------------------------------
    heading("components")
    for i, v in enumerate(["", "Component", "Rule", "Risk level", "Weight", "Factor"], start=1):
        ca.cell(row=row, column=i, value=v)
    style_header(ca, row, 6)
    row += 1

    comps = [
        ("Component 1 - experience frequency", "MAX(stocks, crypto, CFD)",
         f"=MAX(E{q_rows['Equities']},E{q_rows['Crypto']},E{q_rows['LeveragedCfd']})", "B"),
        ("Component 2 - experience volume", "MAX(stocks, crypto, CFD)",
         f"=MAX(E{q_rows['EquitiesInvestedAmount']},E{q_rows['CryptoInvestedAmount']},"
         f"E{q_rows['LeveragedCfdInvestedAmount']})", "B"),
        ("Component 3 - trading knowledge", "single question",
         f"=E{q_rows['TradingKnowledge']}", "B"),
        ("Component 4 - trading strategy", "single question",
         f"=E{q_rows['TradingStrategy']}", "B"),
        ("Component 5 - purpose of trading", "single question",
         f"=E{q_rows['TradingPurpose']}", "A"),
        ("Component 6 - risk appetite", "single question",
         f"=E{q_rows['RiskAppetite']}", "A"),
        ("Component 7 - source of income", "single question",
         f"=E{q_rows['IncomeSource']}", "B"),
        ("Component 8 - knowledge assessment", "score -> band, Medium if nothing ticked",
         f"=IF({ka_ticked}=0,2,LOOKUP(E{ka_total},Scoring!$A${KB_START}:$A${KB_END},"
         f"Scoring!$B${KB_START}:$B${KB_END}))", "B"),
    ]
    if reg["mica"]:
        comps.append(
            ("Component 9 - MiCA crypto assessment", "ROUNDDOWN(AVERAGE(5 questions),0)",
             f"=ROUNDDOWN(AVERAGE({','.join('E' + str(mica_rows[k]) for k, _, _ in MICA)}),0)",
             "B"))

    comp_rows = {}
    for idx, (label, rule, formula, factor) in enumerate(comps, start=1):
        ca.cell(row=row, column=2, value=label).font = BODY
        ca.cell(row=row, column=3, value=rule).font = SMALL
        ca.cell(row=row, column=4,
                value=f'=IFERROR(VLOOKUP(E{row},{LVL},2,FALSE),"")').font = BODY
        ca.cell(row=row, column=5, value=formula).font = BOLD
        ca.cell(row=row, column=5).alignment = CENTER
        ca.cell(row=row, column=5).fill = CALC_FILL
        ca.cell(row=row, column=6, value=f"Factor {factor}").font = SMALL
        boxed(ca, row, 6)
        comp_rows[idx] = row
        row += 1
    if not reg["mica"]:
        ca.cell(row=row, column=2, value=(
            "Component 9 - MiCA crypto assessment    not part of this regulation")).font = SMALL
        ca.cell(row=row, column=6, value="CySEC only").font = SMALL
        boxed(ca, row, 6)
        row += 1

    # ---- hard block, condition by condition -------------------------------
    row += 1
    heading("SuitabilityBlock - the hard block")
    paragraph(
        f"{reg['doc']} defines one check with Condition: All, so every row below has to be "
        f"true before the user is blocked from copy entirely. A question the user has not "
        f"answered makes its row false, which is why an incomplete profile is never blocked.",
        lines=2)
    for i, v in enumerate(["", "Condition", "Blocking answers in this config", "Your answer",
                           "Met?", ""], start=1):
        ca.cell(row=row, column=i, value=v)
    style_header(ca, row, 6)
    row += 1

    cond_rows = []
    for key, blocking in reg["block"]:
        ca.cell(row=row, column=2, value=BLOCK_LABEL[key]).font = BODY
        ca.cell(row=row, column=3, value=", ".join(blocking)).font = SMALL
        ca.cell(row=row, column=3).alignment = WRAP
        ca.cell(row=row, column=4, value=f"=C{q_rows[key]}").font = BODY
        test = "OR(" + ",".join(f'C{q_rows[key]}="{a}"' for a in blocking) + ")"
        ca.cell(row=row, column=5, value=f'=IF({test},"YES","no")').font = BOLD
        ca.cell(row=row, column=5).alignment = CENTER
        boxed(ca, row, 6)
        cond_rows.append(row)
        row += 1

    ca.cell(row=row, column=2, value="Check DefaultResult in the config").font = SMALL
    ca.cell(row=row, column=3, value=reg["default_result"]).font = MONO
    ca.cell(row=row, column=4, value="never evaluated - see note" if reg["note"]
            else "not reached on this code path").font = SMALL
    boxed(ca, row, 6)
    row += 1
    if reg["note"]:
        ca.cell(row=row, column=2, value=reg["note"]).font = ALERT
        ca.cell(row=row, column=2).alignment = WRAP
        ca.merge_cells(start_row=row, start_column=2, end_row=row + 2, end_column=6)
        row += 3

    # ---- result -----------------------------------------------------------
    row += 1
    heading("result")
    for i, v in enumerate(["", "Output", "Formula", "Risk level", "Value", ""], start=1):
        ca.cell(row=row, column=i, value=v)
    style_header(ca, row, 6)
    row += 1

    fa = row
    ca.cell(row=row, column=2, value="Factor A").font = BODY
    ca.cell(row=row, column=3, value="MIN(C5, C6)").font = MONO
    ca.cell(row=row, column=4, value=f'=IFERROR(VLOOKUP(E{row},{LVL},2,FALSE),"")').font = BODY
    ca.cell(row=row, column=5, value=f"=MIN(E{comp_rows[5]},E{comp_rows[6]})").font = BOLD
    row += 1

    fb = row
    b_cells = ",".join(f"E{comp_rows[i]}" for i in sorted(comp_rows)
                       if i not in (5, 6))
    b_names = ",".join(f"C{i}" for i in sorted(comp_rows) if i not in (5, 6))
    ca.cell(row=row, column=2, value="Factor B").font = BODY
    ca.cell(row=row, column=3, value=f"ROUNDDOWN(AVERAGE({b_names}),0)").font = MONO
    ca.cell(row=row, column=4, value=f'=IFERROR(VLOOKUP(E{row},{LVL},2,FALSE),"")').font = BODY
    ca.cell(row=row, column=5, value=f"=ROUNDDOWN(AVERAGE({b_cells}),0)").font = BOLD
    row += 1

    lvl_row = row
    ca.cell(row=row, column=2, value="ClientRiskLevel").font = BOLD
    ca.cell(row=row, column=3, value="MIN(Factor A, Factor B)").font = MONO
    ca.cell(row=row, column=4, value=f'=IFERROR(VLOOKUP(E{row},{LVL},2,FALSE),"")').font = BIG
    ca.cell(row=row, column=5, value=f"=MIN(E{fa},E{fb})").font = BOLD
    row += 1

    ars_row = row
    ca.cell(row=row, column=2, value="AuthorizedRiskScore").font = BOLD
    ca.cell(row=row, column=3, value="RiskLevelToScoreMappings").font = MONO
    ca.cell(row=row, column=4, value="max copyable risk score").font = SMALL
    ca.cell(row=row, column=5,
            value=f'=IFERROR(VLOOKUP(E{lvl_row},{LVL},3,FALSE),"")').font = BIG
    row += 1

    hb_row = row
    all_met = ",".join(f'E{rr}="YES"' for rr in cond_rows)
    ca.cell(row=row, column=2, value="SuitabilityBlock (hard block)").font = BOLD
    ca.cell(row=row, column=3,
            value=f"ALL {len(cond_rows)} conditions above must be met").font = MONO
    ca.cell(row=row, column=5,
            value=f'=IF(AND({all_met}),"BLOCKED","Not blocked")').font = BOLD
    row += 1

    for rr in range(fa, row):
        boxed(ca, rr, 6)
        ca.cell(row=rr, column=4).alignment = CENTER
        ca.cell(row=rr, column=5).alignment = CENTER
        ca.cell(row=rr, column=5).fill = RESULT_FILL

    row += 1
    ca.cell(row=row, column=2, value="OUTCOME").font = H2
    ca.cell(row=row, column=3, value=(
        f'=IF(E{hb_row}="BLOCKED","Fully blocked from copy trading",'
        f'"Risk profile "&D{lvl_row}&" - may copy any trader or portfolio with a risk score of "'
        f'&E{ars_row}&" or below")')).font = BIG
    ca.merge_cells(start_row=row, start_column=3, end_row=row, end_column=6)
    for cc in range(2, 7):
        ca.cell(row=row, column=cc).fill = RESULT_FILL
        ca.cell(row=row, column=cc).border = BOX
    ca.row_dimensions[row].height = 26
    row += 1

    if unscored:
        pur = q_rows["TradingPurpose"]
        never = f'C{pur}="{NEVER_SCORED_PURPOSE}"'
        others = [a for a in unscored if a != NEVER_SCORED_PURPOSE]
        branch = '""'
        if others:
            sel = ",".join(f'C{pur}="{a}"' for a in others)
            branch = (f'IF(OR({sel}),"Note: the funnel offers that answer here, but only CySEC '
                      f'scores it. Component 5 takes the default, Medium, instead of the level '
                      f'CySEC would assign.","")')
        ca.cell(row=row, column=3, value=(
            f'=IF({never},'
            f'"Note: no live config scores that answer to Q8, so component 5 takes the default, '
            f'Medium. The funnel offers it under every regulation.",{branch})')).font = ALERT
        ca.merge_cells(start_row=row, start_column=3, end_row=row + 1, end_column=6)
        ca.cell(row=row, column=3).alignment = WRAP
        ca.row_dimensions[row].height = 14
        row += 3

    # ---- target check -----------------------------------------------------
    heading("check a specific target")
    ca.cell(row=row, column=2, value="Target's risk score (1-10)").font = BODY
    target = ca.cell(row=row, column=3, value=7)
    target.font = BOLD
    target.fill = INPUT_FILL
    target.alignment = CENTER
    boxed(ca, row, 3)
    dv = DataValidation(type="whole", operator="between", formula1=1, formula2=10)
    ca.add_data_validation(dv)
    dv.add(target)
    tgt = row
    row += 1
    ca.cell(row=row, column=2, value="Can this user copy it?").font = BOLD
    ca.cell(row=row, column=3, value=(
        f'=IF(E{hb_row}="BLOCKED","NO - fully blocked from copy",'
        f'IF(C{tgt}<=E{ars_row},"YES - allowed",'
        f'"NO - target risk "&C{tgt}&" exceeds the limit of "&E{ars_row}))')).font = BIG
    ca.merge_cells(start_row=row, start_column=3, end_row=row, end_column=6)
    for cc in range(2, 7):
        ca.cell(row=row, column=cc).fill = RESULT_FILL
        ca.cell(row=row, column=cc).border = BOX
    ca.row_dimensions[row].height = 24
    row += 2

    paragraph(
        "This sheet models gates 1 and 2. Gate 3, ongoing monitoring, is a separate daily "
        "solvency check - see the Monitoring sheet. A user can pass here and still be blocked "
        "from opening new copies.")
    ca.freeze_panes = "A6"


for _reg in REGS:
    build_calculator(_reg)

# ===========================================================================
# Monitoring
# ===========================================================================
mo = wb.create_sheet("Monitoring")
mo["A1"] = "Gate 3 - ongoing monitoring (daily solvency check)"
mo["A1"].font = H1
mo["A2"] = ("Blocks NEW copy positions only. Existing copies are never closed. Evaluated once "
            "per day, so changes take effect the following day.")
mo["A2"].font = SMALL
mo.merge_cells("A2:E2")
widths(mo, {"A": 4, "B": 46, "C": 24, "D": 18, "E": 46})

r = 4
mo.cell(row=r, column=2, value="INPUTS").font = H2
r += 1
for i, v in enumerate(["", "Input", "Your answer", "Value used", "Notes"], start=1):
    mo.cell(row=r, column=i, value=v)
style_header(mo, r, 5)
r += 1
FIRST_INPUT = r


def mo_band_row(label, key, default, note_text, lookup):
    global r
    mo.cell(row=r, column=2, value=label).font = BODY
    cell = mo.cell(row=r, column=3, value=default)
    cell.fill = INPUT_FILL
    cell.font = BOLD
    mo.cell(row=r, column=4, value=f"=IFERROR(VLOOKUP(C{r},{lookup},2,FALSE),0)").number_format = "#,##0"
    mo.cell(row=r, column=5, value=note_text).font = SMALL
    dv = DataValidation(type="list", formula1=list_cols[key], allow_blank=False)
    mo.add_data_validation(dv)
    dv.add(cell)
    here = r
    r += 1
    return here


inc_r = mo_band_row("Q10 - net annual income", "AnnualIncome", BANDS[1], "band midpoint", MID_INC)
nw_r = mo_band_row("Q11 - total net worth / liquid assets", "LiquidAssets", BANDS[1],
                   "band midpoint", MID_INC)
plan_r = mo_band_row("Q14 - planned investment over the coming year", "PlannedInvestment",
                     PLAN[2], "band midpoint; 'Above $1M' is open-ended", MID_PLAN)

mo.cell(row=r, column=2, value="Year of first-time deposit (FTD)").font = BODY
cell = mo.cell(row=r, column=3, value=2021)
cell.fill = INPUT_FILL
cell.font = BOLD
ftd_r = r
r += 1
mo.cell(row=r, column=2, value="Current year").font = BODY
cell = mo.cell(row=r, column=3, value=2026)
cell.fill = INPUT_FILL
cell.font = BOLD
cy_r = r
r += 1
mo.cell(row=r, column=2, value="Years since FTD, including the FTD year").font = BODY
mo.cell(row=r, column=4, value=f"=C{cy_r}-C{ftd_r}+1").font = BOLD
yrs_r = r
r += 1

mo.cell(row=r, column=2, value="Cash currently allocated to copies (CA)").font = BODY
cell = mo.cell(row=r, column=3, value=40000)
cell.fill = INPUT_FILL
cell.font = BOLD
cell.number_format = "#,##0"
mo.cell(row=r, column=5, value="initial investments - cash removed + cash added").font = SMALL
ca_r = r
r += 1
mo.cell(row=r, column=2, value="Realised P/L on closed copies (RPL)").font = BODY
cell = mo.cell(row=r, column=3, value=2000)
cell.fill = INPUT_FILL
cell.font = BOLD
cell.number_format = "#,##0"
mo.cell(row=r, column=5, value="closed mirror positions only").font = SMALL
rpl_r = r
r += 1

for rr in range(FIRST_INPUT, r):
    boxed(mo, rr, 5)
    mo.cell(row=rr, column=4).alignment = CENTER

r += 1
mo.cell(row=r, column=2, value="CALCULATION").font = H2
r += 1
for i, v in enumerate(["", "Term", "Formula", "Value", "Notes"], start=1):
    mo.cell(row=r, column=i, value=v)
style_header(mo, r, 5)
r += 1

fd_r = r
mo.cell(row=r, column=2, value="FSUSTdeclared").font = BODY
mo.cell(row=r, column=3, value="Q14 midpoint x 50% x years since FTD").font = MONO
mo.cell(row=r, column=4, value=f"=D{plan_r}*0.5*D{yrs_r}").number_format = "#,##0"
r += 1
fc_r = r
mo.cell(row=r, column=2, value="FSUSTcalculated").font = BODY
mo.cell(row=r, column=3, value="(Q10 x 50%) + (Q11 x 50%)").font = MONO
mo.cell(row=r, column=4, value=f"=D{inc_r}*0.5+D{nw_r}*0.5").number_format = "#,##0"
r += 1
fs_r = r
mo.cell(row=r, column=2, value="FSUST").font = BOLD
mo.cell(row=r, column=3, value="MIN(declared, calculated)").font = MONO
mo.cell(row=r, column=4, value=f"=MIN(D{fd_r},D{fc_r})").number_format = "#,##0"
mo.cell(row=r, column=4).font = BOLD
r += 1
cu_r = r
mo.cell(row=r, column=2, value="CU (copy utilisation)").font = BOLD
mo.cell(row=r, column=3, value="50% x CA - RPL").font = MONO
mo.cell(row=r, column=4, value=f"=0.5*C{ca_r}-C{rpl_r}").number_format = "#,##0"
mo.cell(row=r, column=4).font = BOLD
r += 1

for rr in range(fd_r, r):
    boxed(mo, rr, 5)
    mo.cell(row=rr, column=4).fill = RESULT_FILL
    mo.cell(row=rr, column=4).alignment = CENTER

r += 1
mo.cell(row=r, column=2, value="OUTCOME").font = H2
mo.cell(row=r, column=3, value=(
    f'=IF(D{cu_r}<=D{fs_r},"Allowed - copy utilisation is within financial sustainability",'
    f'"BLOCKED from opening new copies - utilisation exceeds sustainability")')).font = BIG
mo.merge_cells(start_row=r, start_column=3, end_row=r, end_column=5)
for cc in range(2, 6):
    mo.cell(row=r, column=cc).fill = RESULT_FILL
    mo.cell(row=r, column=cc).border = BOX
mo.row_dimensions[r].height = 26
r += 2
mo.cell(row=r, column=2, value=(
    "Caveat: the source documentation says 'Q1 answer' and 'average of Q3 answer' without "
    "defining which point in a band is used. This sheet uses band midpoints from the client code "
    "(answers.data.ts). A second midpoint table in basic-user.ts disagrees for the top band. "
    "Treat absolute values as indicative; the comparison logic is exact.")).font = SMALL
mo.merge_cells(start_row=r, start_column=2, end_row=r + 2, end_column=5)
mo.cell(row=r, column=2).alignment = WRAP

# ===========================================================================
# Questions reference
# ===========================================================================
qs = wb.create_sheet("Questions")
qs["A1"] = "Question bank"
qs["A1"].font = H1
qs["A2"] = ("Question and answer IDs are confirmed against the KycQuestion and KycAnswer enums in "
            "the KycAnalyzer contract package - the mapping the service itself compiles against.")
qs["A2"].font = SMALL
qs.merge_cells("A2:F2")
widths(qs, {"A": 8, "B": 30, "C": 46, "D": 34, "E": 16, "F": 14})

r = 4
for i, v in enumerate(["Q", "Config name", "Question", "Answer", "Risk level", "Weight"], start=1):
    qs.cell(row=r, column=i, value=v)
style_header(qs, r, 6)
r += 1
for key, qid, qtext, answers in SCORING:
    for ans, level, weight in answers:
        qs.cell(row=r, column=1, value=qid).font = SMALL
        qs.cell(row=r, column=2, value=key).font = MONO
        qs.cell(row=r, column=3, value=qtext).font = BODY
        qs.cell(row=r, column=4, value=ans).font = BODY
        qs.cell(row=r, column=5, value=level).font = BODY
        qs.cell(row=r, column=6, value=weight).font = BOLD
        qs.cell(row=r, column=6).alignment = CENTER
        boxed(qs, r, 6)
        r += 1
for key, qid, qtext in HARD_BLOCK_INPUTS:
    for band in BANDS:
        qs.cell(row=r, column=1, value=qid).font = SMALL
        qs.cell(row=r, column=2, value=key).font = MONO
        qs.cell(row=r, column=3, value=qtext).font = BODY
        qs.cell(row=r, column=4, value=band).font = BODY
        qs.cell(row=r, column=5, value="hard block input").font = SMALL
        boxed(qs, r, 6)
        r += 1
qs.freeze_panes = "A5"

# ===========================================================================
# Legacy reference
# ===========================================================================
lg = wb.create_sheet("Legacy")
lg["A1"] = "Legacy client-side suitability test (pre-2022) - reference only"
lg["A1"].font = H1
lg["A2"] = ("Superseded but still shipped behind the NewSuitability2022 A/B flag. Produced a "
            "binary block, not a risk score. Documented so it is not mistaken for current behaviour.")
lg["A2"].font = SMALL
lg.merge_cells("A2:E2")
widths(lg, {"A": 30, "B": 18, "C": 30, "D": 30, "E": 40})

r = 4
lg.cell(row=r, column=1, value="Sub-tests (true = failed)").font = H2
r += 1
for a, b, c in [
    ("Appropriateness", "Server status", "FAILED=1, SUCCESS=2, BORDER_LINE=3, DEFAULT=0"),
    ("Objectives", "Client",
     "fail if: (CFD never traded AND holds > several months) OR purpose in {future planning, "
     "saving for home} OR risk appetite in {5%/-3%, 10%/-6%}"),
    ("Experience", "Client", "fail if ratio > 0.1 AND appropriateness failed"),
    ("  the ratio", "Client",
     "(deposits - withdrawals) / (income midpoint + liquid-assets midpoint); window is deposits "
     "since FTD if FTD <= 365 days ago, otherwise the last 12 months"),
    ("Low tier", "Client", "income band <= $10K AND liquid assets band <= $10K"),
]:
    lg.cell(row=r, column=1, value=a).font = BOLD
    lg.cell(row=r, column=2, value=b).font = BODY
    lg.cell(row=r, column=3, value=c).font = BODY
    lg.merge_cells(start_row=r, start_column=3, end_row=r, end_column=5)
    lg.cell(row=r, column=3).alignment = WRAP
    lg.row_dimensions[r].height = 30
    boxed(lg, r, 5)
    r += 1

r += 1
lg.cell(row=r, column=1, value="Decision table").font = H2
r += 1
for i, v in enumerate(["Key (appropriateness, objectives, experience, tier)", "suitabilityTestValue",
                       "Next screen", "Copy blocked?", ""], start=1):
    lg.cell(row=r, column=i, value=v)
style_header(lg, r, 5)
r += 1
for key, val, screen, blocked in [
    ("p,p,p,l / p,p,p,h", 1, "none", "no"),
    ("f,p,p,l / f,p,p,h", 1, "Risk Disclosure", "no"),
    ("f,p,f,h", 2, "Suitability Assessment - Experience (high)", "no"),
    ("f,f,p,h", 3, "Suitability Assessment - Experience (high)", "no"),
    ("f,f,f,h", 2, "Suitability Assessment - Experience (high)", "no"),
    ("f,p,f,l", 2, "Suitability Assessment - Experience (low)", "YES"),
    ("f,f,p,l", 3, "Suitability Assessment - Experience (low)", "YES"),
    ("f,f,f,l", 2, "Suitability Assessment - Experience (low)", "YES"),
    ("p,f,p,h", 3, "Suitability Assessment - Objectives (high)", "no"),
    ("p,f,p,l", 3, "Suitability Assessment - Objectives (low)", "YES"),
]:
    lg.cell(row=r, column=1, value=key).font = MONO
    lg.cell(row=r, column=2, value=val).font = BOLD
    lg.cell(row=r, column=2).alignment = CENTER
    lg.cell(row=r, column=3, value=screen).font = BODY
    lg.cell(row=r, column=4, value=blocked).font = BOLD if blocked == "YES" else BODY
    lg.cell(row=r, column=4).alignment = CENTER
    if blocked == "YES":
        lg.cell(row=r, column=4).fill = WARN_FILL
    boxed(lg, r, 5)
    r += 1
r += 1
lg.cell(row=r, column=1, value=(
    "The legacy test only ever blocked LOW-TIER users. A high-tier user who failed everything saw "
    "a warning screen and kept copy access. Six of the sixteen key combinations have no entry.")
).font = SMALL
lg.merge_cells(start_row=r, start_column=1, end_row=r, end_column=5)

# ===========================================================================
# Readme
# ===========================================================================
rm = wb.create_sheet("Readme", 0)
rm["A1"] = "eToro copy-trading suitability test"
rm["A1"].font = Font(bold=True, size=20, color=INK)
widths(rm, {"A": 4, "B": 30, "C": 96})

r = 3


def note(label, text, label_font=BOLD):
    global r
    rm.cell(row=r, column=2, value=label).font = label_font
    cell = rm.cell(row=r, column=3, value=text)
    cell.font = BODY
    cell.alignment = WRAP
    rm.row_dimensions[r].height = max(16, 13 * (len(text) // 95 + 1))
    r += 1


note("What this is",
     "A working model of the live suitability formula that gates copy trading and Smart "
     "Portfolios at eToro. Scoring is taken verbatim from the live "
     "ClientRiskProfileConfiguration documents CySEC-24, FCA-15, ASIC-9, ASIC GAML-15 and "
     "FSRA-10, read from the production Cosmos account.")
r += 1
rm.cell(row=r, column=2, value="Sheets").font = H2
r += 1
note("One tab per regulation",
     "Pick the tab for the regulation the user falls under - " +
     ", ".join(x["sheet"] for x in REGS) + ". Answer the yellow cells and you get a risk "
     "profile and a maximum copyable risk score. Covers gate 1 (hard block) and gate 2 "
     "(risk-score cap). Each tab shows only the questions and block conditions that "
     "regulation actually uses, so nothing on screen is inapplicable.")
note("Monitoring", "Gate 3, the daily solvency check. Blocks new copies when copy utilisation "
                   "exceeds financial sustainability. Not regulation-specific.")
note("Scoring", "Every answer-to-risk-level mapping. The lookup engine every tab reads.")
note("Questions", "The question bank in readable form.")
note("Legacy", "The superseded pre-2022 client-side test, for reference.")

r += 1
rm.cell(row=r, column=2, value="What differs between the five").font = H2
r += 1
for spec in REGS:
    note(spec["sheet"],
         f"{spec['doc']}. Component 9 "
         + ("in Factor B" if spec["mica"] else "not used")
         + f". Scores {len(spec['purposes'])} of the {len(ALL_PURPOSES)} answers the funnel "
         f"offers for Q8. Hard block needs all "
         f"{len(spec['block'])} of "
         + ", ".join(BLOCK_LABEL[k].split()[0] for k, _a in spec["block"])
         + f" to be in range. Check DefaultResult: {spec['default_result']}.")
r += 1
note("On FCA", FCA_DEAD_DEFAULT, label_font=ALERT)
r += 1
rm.cell(row=r, column=2, value="The formula").font = H2
r += 1
for line in [
    "Factor A = MIN(Component 5, Component 6)",
    "Factor B = AVERAGE(Components 1, 2, 3, 4, 7, 8) rounded DOWN",
    "         under CySEC, Component 9 joins that average",
    "ClientRiskLevel = MIN(Factor A, Factor B)",
    "Minimal|Low -> 3    Medium -> 6    MediumHigh -> 8    High -> 10",
    "A user may copy any trader or portfolio whose risk score is at or below that number.",
]:
    rm.cell(row=r, column=3, value=line).font = MONO
    r += 1
r += 1
note("Level ordinals", "Minimal = 0, Low = 1, Medium = 2, MediumHigh = 3, High = 4. "
                       "Unanswered components default to Medium.")
r += 1
rm.cell(row=r, column=2, value="Read before relying on this").font = H2
r += 1
for label, text in [
    ("Verified against the service",
     "Every formula, weight and band here is checked against the KYCAnalyzer source and the "
     "CySEC-24 configuration the service's own tests load. The 14 test vectors in "
     "WeightQuestionAnswerCalculatorTests all reproduce exactly."),
    ("Component 9 is CySEC only",
     "The MiCA crypto block entered Factor B in CySEC-20. FCA, FSRA, ASIC and ASIC GAML average "
     "six components, not seven, so their Factor B row lists six. Use the tab that matches the "
     "user's regulation - the same answers give different outcomes across tabs."),
    ("Gates this does not model",
     "Suitability is skipped below verification level 2, and eToro-country staff are forced to "
     "High when the feature flag is on. Crypto restrictions, professional-copy rules, MiCA "
     "documents and first-copy terms can also block a copy independently of suitability."),
    ("Monitoring midpoints",
     "The band midpoints on the Monitoring sheet match the service's CCM answer-to-amount "
     "mapping, but the weightings x, y and z are read from CCM at runtime and could be retuned "
     "without a code change."),
]:
    note(label, text, label_font=ALERT)

r += 1
note("Source", "rev-eng/suitability-test/ in the etoro-assets repository. "
               "Regenerate this file with build_workbook.py.")

for ws in wb.worksheets:
    ws.sheet_view.showGridLines = False

# Readme first, then a calculator per regulation, then the shared reference sheets.
TAB_ORDER = ["Readme"] + [x["sheet"] for x in REGS] + \
            ["Monitoring", "Scoring", "Questions", "Legacy", "Lists"]
wb._sheets.sort(key=lambda ws: TAB_ORDER.index(ws.title))
wb.active = 0

wb.save(OUT)
print(f"wrote {OUT}")
