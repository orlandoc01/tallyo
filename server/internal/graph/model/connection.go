package model

type Connection struct {
	ID          GlobalID
	Name        *string
	Owner       *Owner
	IsActive    bool
	SourceTable string
	SourceID    int64
}

func (Connection) IsNode() {}

func (c Connection) GetID() GlobalID { return c.ID }
