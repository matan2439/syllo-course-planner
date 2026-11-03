from app.degrees.adapters import tau
from app.degrees.evidence import ADAPTERS

ADAPTERS.update(
    {
        "tau_tochniot": tau.tochniot_evidence,
        "tau_timetable": tau.timetable_evidence,
        "tau_ims": tau.ims_evidence,
    }
)
