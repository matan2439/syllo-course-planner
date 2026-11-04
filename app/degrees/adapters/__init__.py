from app.degrees.adapters import pdf, tau
from app.degrees.evidence import ADAPTERS

ADAPTERS.update(
    {
        "tau_tochniot": tau.tochniot_evidence,
        "tau_timetable": tau.timetable_evidence,
        "tau_ims": tau.ims_evidence,
        "tau_pdf": pdf.pdf_evidence,
    }
)
