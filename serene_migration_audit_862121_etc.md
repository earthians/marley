# Migration Audit Report — Serene Oracle → ERPNext
**Date:** 22 Nov 2026  
**Scope:** Patient file nos OP-IP **862121, 860701, 861602, 316184**  
**Claim:** Missing ECT, Note, Prescription, Lab Test  
**Sources compared:** Oracle `CLINIC2` (docker FREEPDB1) vs ERPNext site `serene`

## Verdict
For these four patients, **migration of ECT / Notes / Prescriptions / Labs is substantially complete**.  
Oracle and ERPNext counts match (or ERP has equal/more) for almost every clinical domain they cited.  
There is **no evidence of a wholesale incomplete migration** for these files.

Two nuance points explain why staff may *think* data is missing:
1. **Two of four patients have zero ECT and zero Lab rows in Oracle** — nothing existed to migrate.
2. A **few Patient Visit header rows** are absent in ERPNext even though linked Notes/Rx/Labs for those visit numbers were imported (orphan clinical data still present under Clinical Note / Medication Order / Lab Test). Empty Oracle visits (no note/Rx/lab) were also skipped.

## Patient identity (both systems)
| File No | Name | In ERPNext |
|--------:|------|:----------:|
| 862121 | ABDULAZIZ ADNAN A ALQERNAS | Yes |
| 860701 | MESHAL ASWAD ALJAZRAH | Yes |
| 861602 | PARNEET KAUR | Yes |
| 316184 | NASER ABDULLA NASER AHMED RUBEEAN | Yes |

## Domain comparison (Oracle → ERPNext)

### 1) ECT (`ECT_00_01` → `ECT Details`)
| Patient | Oracle | ERPNext | Missing keys |
|--------:|-------:|--------:|--------------|
| 862121 | 8 | 8 | none (TRANS_NUM 3076,3078,3083,3086,3087,3093,3098,3100) |
| 860701 | **0** | 0 | n/a — none in source |
| 861602 | **0** | 0 | n/a — none in source |
| 316184 | 10 | 10 | none (TRANS_NUM 1221–1227,1229,1231,1239) |

**Result: 100% match where Oracle had ECT.**

### 2) Lab Test (`LAB_00_03` via patient SUB_DR_GL_CODE → `Lab Test`)
| Patient | Oracle distinct TRANS_NUM | ERPNext Lab Tests | Missing |
|--------:|--------------------------:|------------------:|---------|
| 862121 | 4 | 4 | none (LAB/2026/01053,01082,01114,01365) |
| 860701 | **0** | 0 | n/a |
| 861602 | **0** | 0 | n/a |
| 316184 | 12 | 12 | none (11× LAB/2019/… + LAB/2020/00226 + LAB/2021/00574) |

**Result: 100% match.**

### 3) Clinical Notes (OP visit text + `VISIT_00_01_HISTORY` + IP diagnoses → `Clinical Note`)
Only Oracle rows with real text are expected as Clinical Notes (empty diagnosis fields are not notes).

| Patient | Oracle visit-with-text | Oracle history | Oracle IP diag | Expected | ERP Clinical Notes | Gap |
|--------:|-----------------------:|---------------:|---------------:|---------:|-------------------:|----|
| 862121 | 6 | 92 | 0 | 98 | 98 | 0 |
| 860701 | 6 | 39 | 0 | 45 | 47 | ERP +2 |
| 861602 | 6 | 18 | 0 | 24 | 24 | 0 |
| 316184 | 31 | 1 | 94 | 126 | 125 | −1* |

\* The single “missing” IP note is Oracle `IP_ADMISSION_DIAGNOSES.TRANS_NUM=11761`, whose `DIAGNOSES_DESC` is only a newline (`DUMP` Len=1: 10) — not clinical content. Correctly omitted.

History staging `VISIT_00_01_HISTORY` also matches 92/39/18/1 for the four patients.

**Nursing notes (IP only, patient 316184):** Oracle 475 → ERP `Main Nursing Note` 475 (100%).

### 4) Prescriptions
| Patient | Oracle OP lines | Oracle HIS lines | Oracle IP lines | ERP Medication Orders | ERP Rx lines | Key match |
|--------:|----------------:|-----------------:|----------------:|----------------------:|-------------:|-----------|
| 862121 | 13 | 0 | 0 | 4 | 10 | **3 OP lines missing** (visit 857587 / PRESCRIP_ID 171820–171822, meds 1664,3929,1560) |
| 860701 | 6 | 6 | 0 | 11 | 12 | OP keys matched (HIS are edit history) |
| 861602 | 7 | 12 | 0 | 12 | 19 | OP keys matched |
| 316184 | 53 | 0 | 41 | 35 | 100 | OP + IP keys matched (100 lines ≥ 53+41) |

**Only real prescription gap:** patient **862121**, visit **857587** (19-Sep-2026) — 3 medicine lines not in ERPNext. Same medicines appear again on later visit **859216** (which *was* imported as Rx).

## Patient Visit headers (supporting context)
Some Oracle `VISIT_00_01` rows have no Patient Visit document under the same visit number in ERPNext:

| Patient | Oracle visits | ERP visits | Oracle visit# without ERP header | Clinical impact |
|--------:|--------------:|-----------:|----------------------------------|---------------|
| 862121 | 16 | 18 | 856508, 856889 (empty); 859216 (has note/Rx/lab imported) | Headers only / one orphaned header |
| 860701 | 10 | 10 | 858613 (note+Rx imported without header) | Orphaned header |
| 861602 | 11 | 12 | 857504 (empty in Oracle) | none |
| 316184 | 165 | 167 | 854086,856383,857170,858510 (all empty) | none |

ERP also has extra post go-live visits (names like `100xxxx`), which is expected.

## Root cause summary (for reply to clinic)
1. **Not a failed migration of ECT/Notes/Labs** for these four files — counts match Oracle 1:1 (except one blank IP “note”).
2. **860701 & 861602 never had ECT or Lab Tests in Oracle** — reporting them as “missing after migration” is incorrect.
3. **Likely UX confusion:** clinical data may not sit under the same visit card they used in the old system when the Patient Visit header was not created, even though Notes / Rx / Labs exist when searched by patient.
4. **One genuine Rx gap:** 3 prescription lines on 862121 / visit 857587 — recommend a targeted re-import of that visit’s `PATIENT_VISIT_PRESCRIPTION` rows.
5. **Optional cleanup:** create missing Patient Visit headers for 859216 (862121) and 858613 (860701) so timeline UI shows those encounters.

## How to verify quickly in ERPNext
- Patient **862121** → ECT Details filter patient=862121 (8 rows); Lab Test (4); Clinical Note (98); Medication Order lines (10).
- Patient **316184** → ECT (10); Lab Test (12); Clinical Note (125); Main Nursing Note (475); Medication lines (100).
- Patients **860701 / 861602** → Clinical Notes + prescriptions present; ECT/Lab lists correctly empty.
