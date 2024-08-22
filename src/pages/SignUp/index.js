import React, { useContext } from 'react';
import { useIntl } from 'react-intl';
import { useHistory } from 'react-router-dom';

import { Form, Card, Button, Alert } from 'tabler-react';

import { useFormik } from 'formik';
import * as Yup from 'yup';
import _ from 'lodash';
import PandaBridge from 'pandasuite-bridge';

import * as ROUTES from '../../constants/routes';
import StandaloneFormPage from '../StandaloneFormPage';
import FirebaseBridgeContext from '../../FirebaseBridgeContext';

const SignUp = () => {
  const firebaseWithBridge = useContext(FirebaseBridgeContext);
  const intl = useIntl();
  const history = useHistory();

  const { auth, firestore, bridge } = firebaseWithBridge || {};
  const { properties } = bridge || {};

  const termsValidationSchema = {
    terms: Yup.bool()
      .required(intl.formatMessage({ id: 'form.required' }))
      .oneOf(
        [true],
        intl.formatMessage({ id: 'page.signup.form.input.terms.error' }),
      ),
  };

  const formik = useFormik({
    initialValues: {},
    validationSchema: Yup.object(
      _.merge(
        {
          name: Yup.string().required(
            intl.formatMessage({ id: 'form.required' }),
          ),
          email: Yup.string()
            .required(intl.formatMessage({ id: 'form.required' }))
            .email(
              intl.formatMessage({ id: 'page.signup.form.input.email.error' }),
            ),
          password: Yup.string().required(
            intl.formatMessage({ id: 'form.required' }),
          ),
        },
        properties && properties.terms ? termsValidationSchema : {},
      ),
    ),
    onSubmit: (values) => {
      const { name, email, password, position, company } = values;

      auth
        .createUserWithEmailAndPassword(email, password)
        .then(() => {
          const { currentUser } = auth;
          const fields = {
            name,
            email,
          };

          if (properties.verifyEmail && !currentUser.emailVerified) {
            currentUser.sendEmailVerification();
          }

          if (properties.advancedFields) {
            if (position) {
              fields.position = position;
            }
            if (company) {
              fields.company = company;
            }
          }

          firestore
            .collection('users')
            .doc(currentUser.uid)
            .set(fields)
            .then(() => {
              formik.setSubmitting(false);
            })
            .catch(() => {
              formik.setSubmitting(false);
            });
        })
        .catch((error) => {
          formik.setErrors({ global: error });
          formik.setSubmitting(false);
        });
    },
  });

  return (
    <StandaloneFormPage>
      <Form className="card" onSubmit={formik.handleSubmit}>
        <Card.Body className="p-6">
          <Card.Title RootComponent="div">
            {intl.formatMessage({ id: 'page.signup.form.title' })}
          </Card.Title>
          <Form.Group
            label={intl.formatMessage({
              id: 'page.signup.form.input.name.label',
            })}
            isRequired
          >
            <Form.Input
              name="name"
              placeholder={intl.formatMessage({
                id: 'page.signup.form.input.name.placeholder',
              })}
              onChange={formik.handleChange}
              onBlur={formik.handleBlur}
              value={formik.values && formik.values.name}
              error={formik.errors && formik.errors.name}
              disabled={formik.isSubmitting}
              isRequired
            />
          </Form.Group>
          <Form.Group
            label={intl.formatMessage({
              id: 'page.signup.form.input.email.label',
            })}
            isRequired
          >
            <Form.Input
              name="email"
              placeholder={intl.formatMessage({
                id: 'page.signup.form.input.email.placeholder',
              })}
              onChange={formik.handleChange}
              onBlur={formik.handleBlur}
              value={formik.values && formik.values.email}
              error={formik.errors && formik.errors.email}
              disabled={formik.isSubmitting}
            />
          </Form.Group>
          <Form.Group
            label={intl.formatMessage({
              id: 'page.signup.form.input.password.label',
            })}
            isRequired
          >
            <Form.Input
              name="password"
              type="password"
              placeholder={intl.formatMessage({
                id: 'page.signup.form.input.password.placeholder',
              })}
              onChange={formik.handleChange}
              onBlur={formik.handleBlur}
              value={formik.values && formik.values.password}
              error={formik.errors && formik.errors.password}
              disabled={formik.isSubmitting}
            />
          </Form.Group>
          {properties && properties.advancedFields && (
            <>
              <Form.Group
                label={intl.formatMessage({
                  id: 'page.signup.form.input.position.label',
                })}
              >
                <Form.Input
                  name="position"
                  placeholder={intl.formatMessage({
                    id: 'page.signup.form.input.position.placeholder',
                  })}
                  onChange={formik.handleChange}
                  onBlur={formik.handleBlur}
                  value={formik.values && formik.values.position}
                  error={formik.errors && formik.errors.position}
                  disabled={formik.isSubmitting}
                  isRequired
                />
              </Form.Group>
              <Form.Group
                label={intl.formatMessage({
                  id: 'page.signup.form.input.company.label',
                })}
              >
                <Form.Input
                  name="company"
                  placeholder={intl.formatMessage({
                    id: 'page.signup.form.input.company.placeholder',
                  })}
                  onChange={formik.handleChange}
                  onBlur={formik.handleBlur}
                  value={formik.values && formik.values.company}
                  error={formik.errors && formik.errors.company}
                  disabled={formik.isSubmitting}
                  isRequired
                />
              </Form.Group>
            </>
          )}
          {properties && properties.terms && (
            <>
              {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
              <label className="custom-control custom-checkbox">
                <Form.Input
                  type="checkbox"
                  name="terms"
                  value={formik.values && formik.values.terms}
                  error={formik.errors && formik.errors.terms}
                  disabled={formik.isSubmitting}
                  onChange={formik.handleChange}
                  onBlur={formik.handleBlur}
                  isRequired
                />
                <span className="custom-control-label">
                  <Button
                    className="p-0 m-0"
                    link
                    href="#"
                    onClick={() => {
                      PandaBridge.send('onTermsClicked');
                      return false;
                    }}
                  >
                    {intl.formatMessage({ id: 'page.signup.form.terms' })}
                  </Button>
                </span>
              </label>
            </>
          )}
          {formik.errors && formik.errors.global && (
            <Alert type="danger" className="mt-6" isDismissible>
              {formik.errors.global.message}
              {formik.errors.global.code === 'auth/wrong-password' && (
                <>
                  <br />
                  <Button
                    link
                    className="p-0"
                    href="#"
                    onClick={() => {
                      history.push(
                        `${ROUTES.PASSWORD_FORGET}/${formik.values && formik.values.email}`,
                      );
                    }}
                  >
                    {intl.formatMessage({
                      id: 'page.signup.form.forgot.label',
                    })}
                  </Button>
                </>
              )}
            </Alert>
          )}
          <Form.Footer>
            <Button
              type="submit"
              color="primary"
              loading={formik.isSubmitting}
              disabled={
                formik.isSubmitting ||
                _.isEmpty(formik.values) ||
                !_.isEmpty(formik.errors)
              }
              block
            >
              {intl.formatMessage({ id: 'page.signup.form.button' })}
            </Button>
          </Form.Footer>
          <div className="row row gutters-xs align-items-center mt-5">
            <div className="col col-auto">
              {intl.formatMessage({ id: 'page.signup.form.signin.label' })}
            </div>
            <Button
              link
              className="p-0"
              href="#"
              onClick={() => {
                history.push(ROUTES.SIGN_IN);
              }}
            >
              {intl.formatMessage({ id: 'page.signup.form.signin.action' })}
            </Button>
          </div>
        </Card.Body>
      </Form>
    </StandaloneFormPage>
  );
};

export default SignUp;
