# Resume Generator

A web app where an HR user types keywords and receives a resume tailored to their
needs, built from the owner's real experience data. The engine selects real,
pre-written experience and an LLM tunes only the wording — it never authors facts.

## Language

**Owner**:
The single person the resume is about; the one who enters and maintains the
experience data. There is exactly one Owner.
_Avoid_: User (ambiguous), candidate, author

**HR User**:
A visitor who requests a tailored resume by supplying keywords. Consumes; never
edits the data.
_Avoid_: User (ambiguous), recruiter, viewer

**Position**:
A container for a span of the Owner's experience — company, title, dates, location.
Holds many Bullets. Not itself tailored; it appears if any of its Bullets are selected.
_Avoid_: Job, role, entry

**Bullet**:
The atomic, rankable unit of experience — a single accomplishment written by the
Owner as plain text. Selection and rephrasing both operate at the Bullet level. Carries
no manual tags; the selector infers relevance from the text.
_Avoid_: Point, line, entry, item

**Keywords**:
The free-form text an HR User supplies to describe the role they're hiring for. The
sole tailoring input; drives which Bullets are selected and how they're reworded.
_Avoid_: Query, search terms, filters

**Tailored Resume**:
The output produced for one HR request: the Bullets the selector chose, grouped by
Position (reverse-chronological), Bullets relevance-ordered within each Position, with
wording tuned toward the Keywords. Positions with no selected Bullets are omitted.
_Avoid_: CV, generated resume, output

**Default Resume**:
The resume returned when the Keywords clear no relevance floor: a curated set of the
Owner's strongest general Bullets, not keyword-tailored. Bullets are marked by the
Owner as belonging to this set.
_Avoid_: Fallback, generic resume, base resume
