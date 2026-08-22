package graph

import "tallyo/internal/graph/model"

func validateOptionalGlobalID(id *model.GlobalID, expectedType model.GlobalIDType) error {
	if id == nil {
		return nil
	}
	return id.ValidateType(expectedType)
}
