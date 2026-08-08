/**
 * James Chairman Engine v0.1.0
 *
 * James chairs the Executive Council.
 * He does not answer first—he manages the decision process.
 */

class ChairmanEngine {

  review(councilState){
    const actions = [];

    for(const conflict of (councilState.conflicts || [])){
      if(conflict.type==="recommendation_conflict"){
        actions.push({
          type:"challenge",
          instruction:"Require opposing advisors to defend evidence and identify what would change their recommendation."
        });
      }

      if(conflict.type==="evidence_gap_conflict"){
        actions.push({
          type:"research",
          instruction:"Assign Research to close decision-critical evidence gaps."
        });
      }

      if(conflict.type==="confidence_conflict"){
        actions.push({
          type:"reassess",
          instruction:"Require low-confidence advisors to revisit their conclusions."
        });
      }
    }

    for(const blocker of (councilState.blockers || [])){
      actions.push({
        type:"blocker",
        instruction:`Resolve blocker reported by ${blocker.advisor_id}: ${blocker.risk}`
      });
    }

    return {
      chair:"James",
      meeting_status: actions.length ? "CONTINUE_MEETING" : "READY_FOR_DECISION",
      actions
    };
  }
}

module.exports = { ChairmanEngine };
