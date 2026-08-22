package utils

func Map[T, U any](ts []T, f func(T) U) []U {
	result, _ := MapErr(ts, func(t T) (U, error) {
		return f(t), nil
	})
	return result
}

func MapErr[T, U any](ts []T, f func(T) (U, error)) ([]U, error) {
	result := make([]U, len(ts))
	for i, v := range ts {
		val, err := f(v)
		if err != nil {
			return nil, err
		}
		result[i] = val
	}
	return result, nil
}
